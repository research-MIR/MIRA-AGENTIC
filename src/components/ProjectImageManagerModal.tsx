import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { UploadCloud, Loader2, CheckCircle } from 'lucide-react';
import { useDropzone } from '@/hooks/useDropzone';
import { cn, optimizeImage } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from './ui/skeleton';

interface Project {
  project_id: string;
  project_name: string;
}

interface ImageResult {
  publicUrl: string;
  storagePath: string;
}

interface Job {
  id: string;
  final_result: any;
  context: any;
}

interface ProjectImageManagerModalProps {
  project: Project;
  isOpen: boolean;
  onClose: () => void;
}

export const ProjectImageManagerModal = ({ project, isOpen, onClose }: ProjectImageManagerModalProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [isUploading, setIsUploading] = useState(false);
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());

  const { data: allImages, isLoading: isLoadingImages } = useQuery<ImageResult[]>({
    queryKey: ['allUserImages', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data: jobs, error } = await supabase.from('mira-agent-jobs').select('id, final_result, context').eq('user_id', session.user.id).order('created_at', { ascending: false });
      if (error) throw error;
      
      const images: ImageResult[] = [];
      for (const job of jobs) {
        const jobImages = (job.final_result?.images || job.final_result?.final_generation_result?.response?.images || []);
        for (const img of jobImages) {
          if (img.publicUrl) images.push({ publicUrl: img.publicUrl, storagePath: img.storagePath });
        }
      }
      return Array.from(new Map(images.map(item => [item.publicUrl, item])).values());
    },
    enabled: isOpen && !!session?.user,
  });

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0 || !session?.user) return;
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return showError("Please select valid image files.");

    setIsUploading(true);
    const toastId = showLoading(`Uploading ${imageFiles.length} image(s)...`);

    try {
      const uploadPromises = imageFiles.map(async file => {
        const optimizedFile = await optimizeImage(file);
        const filePath = `${session.user.id}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage.from('mira-generations').upload(filePath, optimizedFile);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from('mira-generations').getPublicUrl(filePath);
        
        const { error: jobError } = await supabase.from('mira-agent-jobs').insert({
          user_id: session.user.id,
          project_id: project.project_id,
          status: 'complete',
          original_prompt: `Uploaded Image: ${file.name}`,
          final_result: { isImageGeneration: true, images: [{ publicUrl, storagePath: filePath }] },
          context: { source: 'project_upload' }
        });
        if (jobError) throw jobError;
      });

      await Promise.all(uploadPromises);
      dismissToast(toastId);
      showSuccess(`${imageFiles.length} image(s) added to project.`);
      queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddFromGallery = async () => {
    if (selectedImages.size === 0 || !session?.user) return;
    setIsUploading(true);
    const toastId = showLoading(`Adding ${selectedImages.size} image(s) to project...`);
    
    try {
      const imagesToAdd = allImages?.filter(img => selectedImages.has(img.publicUrl)) || [];
      const addPromises = imagesToAdd.map(async image => {
        const { error: jobError } = await supabase.from('mira-agent-jobs').insert({
          user_id: session.user.id,
          project_id: project.project_id,
          status: 'complete',
          original_prompt: `Added from Gallery`,
          final_result: { isImageGeneration: true, images: [image] },
          context: { source: 'project_gallery_add' }
        });
        if (jobError) throw jobError;
      });

      await Promise.all(addPromises);
      dismissToast(toastId);
      showSuccess(`${imagesToAdd.length} image(s) added to project.`);
      setSelectedImages(new Set());
      queryClient.invalidateQueries({ queryKey: ['projectPreviews'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to add images: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const toggleImageSelection = (url: string) => {
    setSelectedImages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(url)) {
        newSet.delete(url);
      } else {
        newSet.add(url);
      }
      return newSet;
    });
  };

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: handleFileUpload });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage Images for "{project.project_name}"</DialogTitle>
          <DialogDescription>Upload new images or add existing ones from your gallery to this project.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="upload">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="upload">Upload New</TabsTrigger>
            <TabsTrigger value="gallery">Add from Gallery</TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <div {...dropzoneProps} className={cn("mt-4 h-64 flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors", isDraggingOver ? "border-primary bg-primary/10" : "border-border")}>
              {isUploading ? (
                <>
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  <p className="mt-4 text-muted-foreground">Uploading...</p>
                </>
              ) : (
                <>
                  <UploadCloud className="h-12 w-12 text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">Drag & drop images here, or click to select files</p>
                  <Input {...dropzoneProps} id="file-upload" type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
                </>
              )}
            </div>
          </TabsContent>
          <TabsContent value="gallery">
            <div className="mt-4">
              <ScrollArea className="h-80">
                <div className="grid grid-cols-4 gap-2 pr-4">
                  {isLoadingImages ? (
                    [...Array(8)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)
                  ) : (
                    allImages?.map(image => {
                      const isSelected = selectedImages.has(image.publicUrl);
                      return (
                        <div key={image.publicUrl} className="relative cursor-pointer" onClick={() => toggleImageSelection(image.publicUrl)}>
                          <img src={image.publicUrl} className="w-full h-full object-cover rounded-md" />
                          {isSelected && (
                            <div className="absolute inset-0 bg-black/60 flex items-center justify-center rounded-md">
                              <CheckCircle className="h-8 w-8 text-white" />
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
              <Button onClick={handleAddFromGallery} disabled={isUploading || selectedImages.size === 0} className="w-full mt-4">
                {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Add {selectedImages.size} Selected Image(s)
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};