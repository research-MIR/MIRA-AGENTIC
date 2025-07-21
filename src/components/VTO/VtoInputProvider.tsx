import React, { useState, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModelPoseSelector, VtoModel, ModelPack } from './ModelPoseSelector';
import { SecureImageDisplay } from './SecureImageDisplay';
import { useLanguage } from "@/context/LanguageContext";
import { PlusCircle, Shirt, Users, X, Link2, Shuffle, Info } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useQuery } from '@tanstack/react-query';
import { useSession } from '../Auth/SessionContextProvider';
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export interface QueueItem {
  person: { url: string; file?: File };
  garment: { url: string; file: File };
  appendix?: string;
}

interface VtoInputProviderProps {
  mode: 'one-to-many' | 'precise-pairs' | 'random-pairs';
  onQueueReady: (queue: QueueItem[]) => void;
  onGoBack: () => void;
}

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear }: { onFileSelect: (file: File) => void, title: string, imageUrl: string | null, onClear: () => void }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files[0]) });
  
    if (imageUrl) {
      return (
        <div className="relative aspect-square">
          <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}><X className="h-4 w-4" /></Button>
        </div>
      );
    }
  
    return (
      <div {...dropzoneProps} className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        <div className="text-center pointer-events-none"><PlusCircle className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{title}</p></div>
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files[0])} />
      </div>
    );
};

const MultiImageUploader = ({ onFilesSelect, title, icon, description }: { onFilesSelect: (files: File[]) => void, title: string, icon: React.ReactNode, description: string }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFilesSelect(Array.from(e.dataTransfer.files)) });
  
    return (
      <div {...dropzoneProps} className={cn("flex flex-col h-full justify-center items-center rounded-lg border border-dashed p-2 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        {React.cloneElement(icon as React.ReactElement, { className: "h-6 w-6 text-muted-foreground" })}
        <p className="mt-1 text-xs font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Input ref={inputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e) => e.target.files && onFilesSelect(Array.from(e.target.files))} />
      </div>
    );
};

export const VtoInputProvider = ({ mode, onQueueReady, onGoBack }: VtoInputProviderProps) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  
  const [selectedModelUrls, setSelectedModelUrls] = useState<Set<string>>(new Set());
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [generalAppendix, setGeneralAppendix] = useState("");
  const [randomGarmentFiles, setRandomGarmentFiles] = useState<File[]>([]);
  const [loopModels, setLoopModels] = useState(true);

  const [precisePairs, setPrecisePairs] = useState<QueueItem[]>([]);
  const [tempPairPersonUrl, setTempPairPersonUrl] = useState<string | null>(null);
  const [tempPairGarmentFile, setTempPairGarmentFile] = useState<File | null>(null);
  const [tempPairAppendix, setTempPairAppendix] = useState("");

  const [selectedPackId, setSelectedPackId] = useState<string>('all');

  const { data: packs, isLoading: isLoadingPacks } = useQuery<ModelPack[]>({
    queryKey: ['modelPacks', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-model-packs').select('id, name').eq('user_id', session.user.id);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const { data: models, isLoading: isLoadingModels, error: modelsError } = useQuery<VtoModel[]>({
    queryKey: ['vtoPackModels', session?.user?.id, selectedPackId],
    queryFn: async () => {
      if (!session?.user) return [];
      let query = supabase
        .from('mira-agent-model-generation-jobs')
        .select('id, base_model_image_url, final_posed_images')
        .eq('user_id', session.user.id)
        .eq('status', 'complete');
      
      if (selectedPackId !== 'all') {
        query = query.eq('pack_id', selectedPackId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return data
        .map(job => ({
          jobId: job.id,
          baseModelUrl: job.base_model_image_url,
          poses: (job.final_posed_images || []).filter((p: any) => p.is_upscaled)
        }))
        .filter(model => model.poses.length > 0);
    },
    enabled: !!session?.user,
  });

  const garmentFileUrl = useMemo(() => garmentFile ? URL.createObjectURL(garmentFile) : null, [garmentFile]);
  const tempPairGarmentUrl = useMemo(() => tempPairGarmentFile ? URL.createObjectURL(tempPairGarmentFile) : null, [tempPairGarmentFile]);

  const handleMultiModelSelect = (poseUrls: string[]) => {
    setSelectedModelUrls(prev => {
      const newSet = new Set(prev);
      const isSelected = poseUrls.length > 0 && newSet.has(poseUrls[0]);
      if (isSelected) {
        poseUrls.forEach(url => newSet.delete(url));
      } else {
        poseUrls.forEach(url => newSet.add(url));
      }
      return newSet;
    });
  };

  const handleSingleModelSelect = (poseUrls: string[]) => {
    if (poseUrls.length > 0) {
      setTempPairPersonUrl(poseUrls[0]);
    }
    setIsModelModalOpen(false);
  };

  const handleUseEntirePack = (models: VtoModel[]) => {
    const allUrls = models.flatMap(model => model.poses.map(p => p.final_url));
    setSelectedModelUrls(new Set(allUrls));
  };

  const addPrecisePair = () => {
    if (tempPairPersonUrl && tempPairGarmentFile) {
      const garmentUrl = URL.createObjectURL(tempPairGarmentFile);
      const newPair: QueueItem = {
        person: { url: tempPairPersonUrl },
        garment: { url: garmentUrl, file: tempPairGarmentFile },
        appendix: tempPairAppendix
      };
      setPrecisePairs(prev => [...prev, newPair]);
      setTempPairPersonUrl(null);
      setTempPairGarmentFile(null);
      setTempPairAppendix("");
    }
  };

  const handleProceed = () => {
    let queue: QueueItem[] = [];
    if (mode === 'one-to-many' && garmentFile) {
      queue = Array.from(selectedModelUrls).map(personUrl => ({
        person: { url: personUrl },
        garment: { url: URL.createObjectURL(garmentFile), file: garmentFile },
        appendix: generalAppendix,
      }));
    } else if (mode === 'random-pairs') {
      if (models && selectedModelUrls.size > 0 && randomGarmentFiles.length > 0) {
        const selectedModels = models.filter(model => 
            model.poses.some(pose => selectedModelUrls.has(pose.final_url))
        );
        const garments = randomGarmentFiles.map(f => ({ file: f, url: URL.createObjectURL(f) }));

        const shuffledModels = [...selectedModels].sort(() => 0.5 - Math.random());
        const shuffledGarments = [...garments].sort(() => 0.5 - Math.random());

        if (loopModels && shuffledModels.length > 0) {
            const numGarments = shuffledGarments.length;
            const numModels = shuffledModels.length;
            
            for (let i = 0; i < numGarments; i++) {
                const model = shuffledModels[i % numModels]; // Loop through models
                const garment = shuffledGarments[i];
                
                for (const pose of model.poses) {
                    queue.push({
                        person: { url: pose.final_url },
                        garment: { url: garment.url, file: garment.file },
                        appendix: generalAppendix,
                    });
                }
            }
        } else {
            const numPairs = Math.min(shuffledModels.length, shuffledGarments.length);
            for (let i = 0; i < numPairs; i++) {
                const model = shuffledModels[i];
                const garment = shuffledGarments[i];

                for (const pose of model.poses) {
                    queue.push({
                        person: { url: pose.final_url },
                        garment: { url: garment.url, file: garment.file },
                        appendix: generalAppendix,
                    });
                }
            }
        }
      }
    } else if (mode === 'precise-pairs') {
      queue = precisePairs;
    }
    onQueueReady(queue);
  };

  const isProceedDisabled = mode === 'one-to-many' 
    ? (selectedModelUrls.size === 0 || !garmentFile)
    : mode === 'random-pairs'
    ? (selectedModelUrls.size === 0 || randomGarmentFiles.length === 0)
    : precisePairs.length === 0;

  const renderOneToMany = () => (
    <Card>
      <CardHeader>
        <CardTitle>{t('oneToManyInputTitle')}</CardTitle>
        <CardDescription>{t('oneToManyInputDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>{t('selectModels')}</Label>
            <Button variant="outline" className="w-full" onClick={() => setIsModelModalOpen(true)}>
              {t('selectModels')} ({selectedModelUrls.size})
            </Button>
            <ModelPoseSelector mode="get-all" onUseEntirePack={handleUseEntirePack} models={models || []} isLoading={isLoadingModels} error={modelsError as Error | null} packs={packs} isLoadingPacks={isLoadingPacks} selectedPackId={selectedPackId} setSelectedPackId={setSelectedPackId} />
          </div>
          <div className="space-y-2">
            <Label>{t('uploadGarment')}</Label>
            <div className="aspect-square max-w-xs mx-auto">
              <ImageUploader onFileSelect={(files) => files && setGarmentFile(files[0])} title={t('garmentImage')} imageUrl={garmentFileUrl} onClear={() => setGarmentFile(null)} />
            </div>
          </div>
        </div>
        <div>
          <Label htmlFor="general-appendix">{t('promptAppendix')}</Label>
          <Textarea id="general-appendix" value={generalAppendix} onChange={(e) => setGeneralAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
        </div>
      </CardContent>
    </Card>
  );

  const renderRandomPairs = () => (
    <Card>
      <CardHeader>
        <CardTitle>{t('randomPairsInputTitle')}</CardTitle>
        <CardDescription>{t('randomPairsInputDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>{t('selectModels')}</Label>
            <Button variant="outline" className="w-full" onClick={() => setIsModelModalOpen(true)}>
              {t('selectModels')} ({selectedModelUrls.size})
            </Button>
            <ModelPoseSelector mode="get-all" onUseEntirePack={handleUseEntirePack} models={models || []} isLoading={isLoadingModels} error={modelsError as Error | null} packs={packs} isLoadingPacks={isLoadingPacks} selectedPackId={selectedPackId} setSelectedPackId={setSelectedPackId} />
          </div>
          <div className="space-y-2">
            <Label>{t('uploadGarments')}</Label>
            <div className="h-32">
              <MultiImageUploader onFilesSelect={setRandomGarmentFiles} title={t('uploadGarments')} icon={<Shirt />} description={t('selectMultipleGarmentImages')} />
            </div>
            {randomGarmentFiles.length > 0 && (
              <ScrollArea className="h-24 mt-2 border rounded-md p-2">
                <div className="grid grid-cols-5 gap-2">
                  {randomGarmentFiles.map((file, i) => <img key={i} src={URL.createObjectURL(file)} className="w-full h-full object-cover rounded-md aspect-square" />)}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
         <div>
          <Label htmlFor="general-appendix-random">{t('promptAppendix')}</Label>
          <Textarea id="general-appendix-random" value={generalAppendix} onChange={(e) => setGeneralAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
        </div>
        <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <div className="flex items-center gap-2">
                <Label htmlFor="loop-models-switch" className="text-sm font-medium">
                    {t('loopModels')}
                </Label>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="max-w-xs">{t('loopModelsDescription')}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <Switch
                id="loop-models-switch"
                checked={loopModels}
                onCheckedChange={setLoopModels}
            />
        </div>
      </CardContent>
    </Card>
  );

  const renderPrecisePairs = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <Card>
        <CardHeader>
            <CardTitle>{t('precisePairsInputTitle')}</CardTitle>
            <CardDescription>{t('precisePairsInputDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
                <Label>{t('person')}</Label>
                <div className="aspect-square w-full bg-muted rounded-md flex items-center justify-center">
                    {tempPairPersonUrl ? (
                        <div className="relative w-full h-full">
                            <SecureImageDisplay imageUrl={tempPairPersonUrl} alt="Selected Person" />
                            <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={() => setTempPairPersonUrl(null)}><X className="h-4 w-4" /></Button>
                        </div>
                    ) : (
                        <Button variant="outline" onClick={() => setIsModelModalOpen(true)}>Select Model</Button>
                    )}
                </div>
            </div>
            <ImageUploader onFileSelect={(files) => files && setTempPairGarmentFile(files[0])} title={t('garment')} imageUrl={tempPairGarmentUrl} onClear={() => setTempPairGarmentFile(null)} />
          </div>
          <div>
            <Label htmlFor="pair-appendix">{t('promptAppendixPair')}</Label>
            <Input id="pair-appendix" value={tempPairAppendix} onChange={(e) => setTempPairAppendix(e.target.value)} placeholder={t('promptAppendixPairPlaceholder')} />
          </div>
          <Button className="w-full" onClick={addPrecisePair} disabled={!tempPairPersonUrl || !tempPairGarmentFile}>{t('addPairToQueue')}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('batchQueue')}</CardTitle></CardHeader>
        <CardContent>
          <ScrollArea className="h-96">
            <div className="space-y-2 pr-4">
              {precisePairs.map((pair, i) => (
                <div key={i} className="flex gap-2 items-center bg-muted p-2 rounded-md">
                  <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0"><SecureImageDisplay imageUrl={pair.person.url} alt="Person" /></div>
                  <PlusCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0"><img src={pair.garment.url} alt="Garment" className="w-full h-full object-cover" /></div>
                  <p className="text-xs text-muted-foreground flex-1 truncate italic">"{pair.appendix}"</p>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPrecisePairs(p => p.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {mode === 'one-to-many' && renderOneToMany()}
          {mode === 'random-pairs' && renderRandomPairs()}
          {mode === 'precise-pairs' && renderPrecisePairs()}
        </div>
        <div className="lg:col-span-1 space-y-6">
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={handleProceed} disabled={isProceedDisabled}>{t('reviewQueue', { count: mode === 'precise-pairs' ? precisePairs.length : selectedModelUrls.size })}</Button>
            <Button variant="outline" onClick={onGoBack}>{t('goBack')}</Button>
          </div>
        </div>
      </div>
      <Dialog open={isModelModalOpen} onOpenChange={setIsModelModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Select a Model</DialogTitle></DialogHeader>
          <ModelPoseSelector 
            mode={mode === 'precise-pairs' ? 'single' : 'multiple'} 
            selectedUrls={selectedModelUrls} 
            onSelect={mode === 'precise-pairs' ? handleSingleModelSelect : handleMultiModelSelect}
            onUseEntirePack={handleUseEntirePack}
            models={models || []}
            isLoading={isLoadingModels}
            error={modelsError as Error | null}
            packs={packs}
            isLoadingPacks={isLoadingPacks}
            selectedPackId={selectedPackId}
            setSelectedPackId={setSelectedPackId}
          />
          <DialogFooter>
            <Button onClick={() => setIsModelModalOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};