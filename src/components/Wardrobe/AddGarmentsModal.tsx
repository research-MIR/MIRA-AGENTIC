import { useState, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle, Loader2, UploadCloud } from 'lucide-react';
import { cn, optimizeImage, calculateFileHash, sanitizeFilename } from '@/lib/utils';
import { SecureImageDisplay } from '@/components/VTO/SecureImageDisplay';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDropzone } from '@/hooks/useDropzone';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/context/LanguageContext';

interface Garment {
  id: string;
  name: string;
  storage_path: string;
  attributes: {
    intended_gender: 'male' | 'female' | 'unisex';
    type_of_fit: 'upper body' | 'lower body' | 'full body' | 'shoes' | 'upper_body' | 'lower_body' | 'full_body';
    primary_color: string;
    style_tags?: string[];
  } | null;
}

interface AddGarmentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  packId: string;
  existingGarmentIds: string[];
  existingGarments: Garment[];
}

const MAX_PER_ZONE = 10;

export const AddGarmentsModal = ({ isOpen, onClose, packId, existingGarmentIds, existingGarments }: AddGarmentsModalProps) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: allGarments, isLoading, error } = useQuery<Garment[]>({
    queryKey: ['allGarmentsForPack', session?.user?.id, existingGarmentIds],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-garments').select('id, name, storage_path, attributes').eq('user_id', session.user.id);
      if (error) throw error;
      return data.filter(g => !existingGarmentIds.includes(g.id));
    },
    enabled: isOpen,
  });

  const existingCounts = useMemo(() => {
    const counts: Record<string, number> = { 'upper_body': 0, 'lower_body': 0, 'full_body': 0, 'shoes': 0 };
    existingGarments.forEach(g => {
      if (g.attributes?.type_of_fit) {
        const fitType = g.attributes.type_of_fit.replace(/ /g, '_');
        if (counts.hasOwnProperty(fitType)) {
          counts[fitType]++;
        }
      }
    });
    return counts;
  }, [existingGarments]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !session?.user) return;
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return showError("Please select valid image files.");

    setIsAdding(true);
    const toastId = showLoading(`Processing ${imageFiles.length} image(s)...`);
    
    const currentCounts = { ...existingCounts };
    const skippedFiles: string[] = [];
    const itemsToInsert: { pack_id: string; garment_id: string }[] = [];

    try {
      const processFile = async (file: File) => {
        const hash = await calculateFileHash(file);
        const { data: existing } = await supabase.from('mira-agent-garments').select('id, attributes').eq('user_id', session!.user.id).eq('image_hash', hash).single();
        
        let garmentId = existing?.id;
        let garmentAttributes = existing?.attributes;

        if (!garmentId) {
          const optimizedFile = await optimizeImage(file);
          const filePath = `${session.user.id}/wardrobe/${Date.now()}-${sanitizeFilename(file.name)}`;
          const { error: uploadError } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, optimizedFile);
          if (uploadError) throw new Error(`Upload failed for ${file.name}: ${uploadError.message}`);
          
          const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
          
          const { data: analysis, error: analysisError } = await supabase.functions.invoke('MIRA-AGENT-tool-analyze-garment-attributes', {
            body: { image_base64: (await fileToBase64(optimizedFile)), mime_type: optimizedFile.type }
          });
          if (analysisError) throw new Error(`Analysis failed for ${file.name}: ${analysisError.message}`);
          garmentAttributes = analysis;

          const { data: newGarment, error: insertError } = await supabase.from('mira-agent-garments').insert({
            user_id: session.user.id,
            name: file.name,
            storage_path: publicUrl,
            attributes: analysis,
            image_hash: hash,
          }).select('id').single();
          if (insertError) throw new Error(`Failed to save garment ${file.name}: ${insertError.message}`);
          garmentId = newGarment.id;
        }
        
        const zone = garmentAttributes?.type_of_fit?.replace(/ /g, '_');
        if (zone && currentCounts[zone] < MAX_PER_ZONE) {
            if (garmentId && !existingGarmentIds.includes(garmentId)) {
                itemsToInsert.push({ pack_id: packId, garment_id: garmentId });
                currentCounts[zone]++;
            }
        } else {
            skippedFiles.push(file.name);
        }
      };

      await Promise.all(imageFiles.map(processFile));

      if (itemsToInsert.length > 0) {
        const { error: linkError } = await supabase.from('mira-agent-garment-pack-items').insert(itemsToInsert);
        if (linkError) throw linkError;
      }
      
      dismissToast(toastId);
      let successMessage = `${itemsToInsert.length} garments processed and added to pack.`;
      if (skippedFiles.length > 0) {
        successMessage += ` ${skippedFiles.length} files were skipped as their body zone is full.`;
      }
      showSuccess(successMessage);
      queryClient.invalidateQueries({ queryKey: ['garmentsInPack', packId] });
      queryClient.invalidateQueries({ queryKey: ['allGarmentsForPack'] });
      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsAdding(false);
    }
  };

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => handleFileUpload(e.dataTransfer.files) });

  const toggleSelection = (garment: Garment) => {
    const zoneWithSpaceOrUnderscore = garment.attributes?.type_of_fit;
    if (!zoneWithSpaceOrUnderscore) return;

    const zone = zoneWithSpaceOrUnderscore.replace(/ /g, '_'); // Standardize to underscore

    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(garment.id)) {
        newSet.delete(garment.id);
      } else {
        const selectedInZone = Array.from(newSet)
          .map(id => allGarments?.find(g => g.id === id))
          .filter(g => g?.attributes?.type_of_fit?.replace(/ /g, '_') === zone).length;
        
        const countInPack = existingCounts[zone] || 0;

        if (countInPack + selectedInZone < MAX_PER_ZONE) {
          newSet.add(garment.id);
        } else {
          showError(`Cannot add more than ${MAX_PER_ZONE} items for the '${zone.replace(/_/g, ' ')}' category.`);
        }
      }
      return newSet;
    });
  };

  const handleAddFromWardrobe = async () => {
    if (selectedIds.size === 0) return;
    setIsAdding(true);
    const toastId = showLoading(`Adding ${selectedIds.size} garments...`);
    try {
      const itemsToInsert = Array.from(selectedIds).map(garment_id => ({ pack_id: packId, garment_id }));
      const { error } = await supabase.from('mira-agent-garment-pack-items').insert(itemsToInsert);
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(`${selectedIds.size} garments added to pack.`);
      queryClient.invalidateQueries({ queryKey: ['garmentsInPack', packId] });
      queryClient.invalidateQueries({ queryKey: ['allGarmentsForPack'] });
      setSelectedIds(new Set());
      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to add garments: ${err.message}`);
    } finally {
      setIsAdding(false);
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add Garments to Pack</DialogTitle>
          <DialogDescription>Upload new garments or add existing ones from your wardrobe.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="upload">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload">{t('uploadNew')}</TabsTrigger>
            <TabsTrigger value="wardrobe">{t('selectFromWardrobe')}</TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <div {...dropzoneProps} className={cn("mt-4 h-80 flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors", isDraggingOver ? "border-primary bg-primary/10" : "border-border")}>
              {isAdding ? (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  <p className="mt-4 text-muted-foreground">Processing...</p>
                </>
              ) : (
                <>
                  <UploadCloud className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">Drag & drop images here, or click to select files</p>
                  <Input {...dropzoneProps} ref={fileInputRef} id="file-upload" type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
                </>
              )}
            </div>
          </TabsContent>
          <TabsContent value="wardrobe">
            <ScrollArea className="h-80 my-4">
              <div className="grid grid-cols-4 gap-4 pr-4">
                {isLoading ? (
                  [...Array(8)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)
                ) : error ? (
                  <Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{error.message}</AlertDescription></Alert>
                ) : allGarments && allGarments.length > 0 ? (
                  allGarments.map(garment => {
                    const isSelected = selectedIds.has(garment.id);
                    const zone = garment.attributes?.type_of_fit?.replace(/ /g, '_');
                    const isDisabled = zone ? (existingCounts[zone] || 0) >= MAX_PER_ZONE : false;
                    return (
                      <div key={garment.id} className={cn("relative cursor-pointer", isDisabled && "opacity-50 cursor-not-allowed")} onClick={() => !isDisabled && toggleSelection(garment)}>
                        <SecureImageDisplay imageUrl={garment.storage_path} alt={garment.name} />
                        {isSelected && (
                          <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-md">
                            <CheckCircle className="h-8 w-8 text-white" />
                          </div>
                        )}
                        {isDisabled && !isSelected && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-md">
                                <p className="text-white text-xs font-bold text-center">Zone Full</p>
                            </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <p className="col-span-4 text-center text-muted-foreground">{t('wardrobeIsEmpty')}</p>
                )}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={handleAddFromWardrobe} disabled={isAdding || selectedIds.size === 0}>
                {isAdding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('addSelected')} ({selectedIds.size})
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};