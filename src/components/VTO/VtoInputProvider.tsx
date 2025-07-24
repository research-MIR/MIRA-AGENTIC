import React, { useState, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ModelPoseSelector, VtoModel, ModelPack } from './ModelPoseSelector';
import { SecureImageDisplay } from './SecureImageDisplay';
import { useLanguage } from "@/context/LanguageContext";
import { PlusCircle, Shirt, Users, X, Link2, Shuffle, Info, Loader2, Wand2, Library } from 'lucide-react';
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '../Auth/SessionContextProvider';
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { showError } from '@/utils/toast';
import { optimizeImage, sanitizeFilename } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';

interface Garment {
  id: string;
  storage_path: string;
  attributes: {
    intended_gender: 'male' | 'female' | 'unisex';
    type_of_fit: 'upper body' | 'lower body' | 'full body';
    [key: string]: any;
  } | null;
}

interface AnalyzedGarment {
  file: File;
  previewUrl: string;
  analysis: Garment['attributes'];
  isAnalyzing: boolean;
}

export interface QueueItem {
  person: { url: string; file?: File; model_job_id?: string };
  garment: { url: string; file: File; analysis?: AnalyzedGarment['analysis'] };
  appendix?: string;
}

interface VtoInputProviderProps {
  mode: 'one-to-many' | 'precise-pairs' | 'random-pairs';
  onQueueReady: (queue: QueueItem[]) => void;
  onGoBack: () => void;
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

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
  const queryClient = useQueryClient();
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  
  const [selectedModelUrls, setSelectedModelUrls] = useState<Set<string>>(new Set());
  const [analyzedGarment, setAnalyzedGarment] = useState<AnalyzedGarment | null>(null);
  const [generalAppendix, setGeneralAppendix] = useState("");
  const [analyzedRandomGarments, setAnalyzedRandomGarments] = useState<AnalyzedGarment[]>([]);
  const [loopModels, setLoopModels] = useState(true);

  const [precisePairs, setPrecisePairs] = useState<QueueItem[]>([]);
  const [tempPairPersonUrl, setTempPairPersonUrl] = useState<string | null>(null);
  const [tempPairGarmentFile, setTempPairGarmentFile] = useState<File | null>(null);
  const [tempPairAppendix, setTempPairAppendix] = useState("");

  const [selectedPackId, setSelectedPackId] = useState<string>('all');
  const [selectedGarmentIds, setSelectedGarmentIds] = useState<Set<string>>(new Set());

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
        .select('id, base_model_image_url, final_posed_images, gender')
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
          poses: (job.final_posed_images || []).filter((p: any) => p.is_upscaled),
          gender: job.gender,
        }))
        .filter(model => model.poses.length > 0);
    },
    enabled: !!session?.user,
  });

  const { data: wardrobe, isLoading: isLoadingWardrobe } = useQuery<Garment[]>({
    queryKey: ['userGarments', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-garments').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const tempPairGarmentUrl = useMemo(() => tempPairGarmentFile ? URL.createObjectURL(tempPairGarmentFile) : null, [tempPairGarmentFile]);

  const isAnalyzingGarments = useMemo(() => {
    if (mode === 'one-to-many') {
      return analyzedGarment?.isAnalyzing ?? false;
    }
    if (mode === 'random-pairs') {
      return analyzedRandomGarments.some(g => g.isAnalyzing);
    }
    return false;
  }, [mode, analyzedGarment, analyzedRandomGarments]);

  const isProceedDisabled = useMemo(() => {
    if (isAnalyzingGarments) return true;

    if (mode === 'one-to-many') {
        return selectedModelUrls.size === 0 || !analyzedGarment || !analyzedGarment.analysis;
    }
    if (mode === 'random-pairs') {
        return selectedModelUrls.size === 0 || analyzedRandomGarments.length === 0 || analyzedRandomGarments.some(g => !g.analysis);
    }
    if (mode === 'precise-pairs') {
        return precisePairs.length === 0;
    }
    return true;
  }, [isAnalyzingGarments, mode, selectedModelUrls, analyzedGarment, analyzedRandomGarments, precisePairs]);

  const analyzeAndSaveGarment = async (file: File): Promise<AnalyzedGarment> => {
    const newGarment: AnalyzedGarment = {
        file,
        previewUrl: URL.createObjectURL(file),
        analysis: null,
        isAnalyzing: true,
    };

    try {
        const [base64, optimizedFile] = await Promise.all([
            fileToBase64(file),
            optimizeImage(file)
        ]);

        const { data: analysis, error: analysisError } = await supabase.functions.invoke('MIRA-AGENT-tool-analyze-garment-attributes', {
            body: { image_base64: base64, mime_type: file.type }
        });
        if (analysisError) throw analysisError;

        const sanitizedName = sanitizeFilename(optimizedFile.name);
        const filePath = `${session?.user.id}/garments/${Date.now()}-${sanitizedName}`;
        const { error: uploadError } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, optimizedFile);
        if (uploadError) throw uploadError;

        const { error: insertError } = await supabase.from('mira-agent-garments').insert({
            user_id: session?.user.id,
            name: file.name,
            storage_path: filePath,
            attributes: analysis
        });
        if (insertError) throw insertError;

        queryClient.invalidateQueries({ queryKey: ['userGarments', session?.user?.id] });
        return { ...newGarment, analysis, isAnalyzing: false };
    } catch (err) {
        console.error(`Failed to process garment ${file.name}:`, err);
        return { ...newGarment, analysis: null, isAnalyzing: false };
    }
  };

  const handleGarmentFileSelect = async (files: FileList) => {
    const file = files?.[0];
    if (!file) {
        setAnalyzedGarment(null);
        return;
    }
    const newGarment: AnalyzedGarment = { file, previewUrl: URL.createObjectURL(file), analysis: null, isAnalyzing: true };
    setAnalyzedGarment(newGarment);
    const result = await analyzeAndSaveGarment(file);
    setAnalyzedGarment(result);
  };

  const handleRandomGarmentFilesSelect = async (files: File[]) => {
    const newGarments: AnalyzedGarment[] = files.map(file => ({
        file,
        previewUrl: URL.createObjectURL(file),
        analysis: null,
        isAnalyzing: true,
    }));
    setAnalyzedRandomGarments(prev => [...prev, ...newGarments]);

    newGarments.forEach(async (garment) => {
        const result = await analyzeAndSaveGarment(garment.file);
        setAnalyzedRandomGarments(prev => prev.map(g => g.file === garment.file ? result : g));
    });
  };

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
    const allSelectedModels = models?.filter(model => 
        model.poses.some(pose => selectedModelUrls.has(pose.final_url))
    ) || [];

    const maleModels = allSelectedModels.filter(m => m.gender === 'male');
    const femaleModels = allSelectedModels.filter(m => m.gender === 'female');

    if (mode === 'one-to-many' && analyzedGarment?.analysis) {
        const garment = analyzedGarment;
        const garmentGender = garment.analysis.intended_gender;
        
        let targetModels: VtoModel[] = [];
        if (garmentGender === 'male') targetModels = maleModels;
        else if (garmentGender === 'female') targetModels = femaleModels;
        else if (garmentGender === 'unisex') targetModels = [...maleModels, ...femaleModels];

        queue = targetModels.flatMap(model => 
            model.poses
                .filter(pose => selectedModelUrls.has(pose.final_url))
                .map(pose => ({
                    person: { url: pose.final_url, model_job_id: model.jobId },
                    garment: { url: garment.previewUrl, file: garment.file, analysis: garment.analysis },
                    appendix: generalAppendix,
                }))
        );
    } else if (mode === 'random-pairs') {
        const maleGarments = analyzedRandomGarments.filter(g => g.analysis?.intended_gender === 'male');
        const femaleGarments = analyzedRandomGarments.filter(g => g.analysis?.intended_gender === 'female');
        const unisexGarments = analyzedRandomGarments.filter(g => g.analysis?.intended_gender === 'unisex');

        const maleGarmentTasks = [...maleGarments, ...unisexGarments];
        const femaleGarmentTasks = [...femaleGarments, ...unisexGarments];

        if (loopModels) {
            maleGarmentTasks.forEach((garment, i) => {
                if (maleModels.length > 0) {
                    const model = maleModels[i % maleModels.length];
                    model.poses.forEach(pose => {
                        if (selectedModelUrls.has(pose.final_url)) {
                            queue.push({ person: { url: pose.final_url, model_job_id: model.jobId }, garment: { url: garment.previewUrl, file: garment.file, analysis: garment.analysis }, appendix: generalAppendix });
                        }
                    });
                }
            });
            femaleGarmentTasks.forEach((garment, i) => {
                if (femaleModels.length > 0) {
                    const model = femaleModels[i % femaleModels.length];
                    model.poses.forEach(pose => {
                        if (selectedModelUrls.has(pose.final_url)) {
                            queue.push({ person: { url: pose.final_url, model_job_id: model.jobId }, garment: { url: garment.previewUrl, file: garment.file, analysis: garment.analysis }, appendix: generalAppendix });
                        }
                    });
                }
            });
        } else {
            if (maleGarmentTasks.length > maleModels.length) {
                showError(`Cannot pair ${maleGarmentTasks.length} male/unisex garments with only ${maleModels.length} male models in strict mode.`);
                return;
            }
            if (femaleGarmentTasks.length > femaleModels.length) {
                showError(`Cannot pair ${femaleGarmentTasks.length} female/unisex garments with only ${femaleModels.length} female models in strict mode.`);
                return;
            }
            maleGarmentTasks.forEach((garment, i) => {
                const model = maleModels[i];
                model.poses.forEach(pose => {
                    if (selectedModelUrls.has(pose.final_url)) {
                        queue.push({ person: { url: pose.final_url, model_job_id: model.jobId }, garment: { url: garment.previewUrl, file: garment.file, analysis: garment.analysis }, appendix: generalAppendix });
                    }
                });
            });
            femaleGarmentTasks.forEach((garment, i) => {
                const model = femaleModels[i];
                model.poses.forEach(pose => {
                    if (selectedModelUrls.has(pose.final_url)) {
                        queue.push({ person: { url: pose.final_url, model_job_id: model.jobId }, garment: { url: garment.previewUrl, file: garment.file, analysis: garment.analysis }, appendix: generalAppendix });
                    }
                });
            });
        }
    } else if (mode === 'precise-pairs') {
      queue = precisePairs;
    }
    onQueueReady(queue);
  };

  const queueCount = useMemo(() => {
    if (mode === 'one-to-many') return selectedModelUrls.size;
    if (mode === 'random-pairs') return analyzedRandomGarments.length;
    if (mode === 'precise-pairs') return precisePairs.length;
    return 0;
  }, [mode, selectedModelUrls, analyzedRandomGarments, precisePairs]);

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
            <div className="aspect-square max-w-xs mx-auto relative">
              <ImageUploader onFileSelect={(files) => handleGarmentFileSelect(files)} title={t('garmentImage')} imageUrl={analyzedGarment?.previewUrl || null} onClear={() => setAnalyzedGarment(null)} />
              {analyzedGarment?.isAnalyzing && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-md">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}
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
              <MultiImageUploader onFilesSelect={handleRandomGarmentFilesSelect} title={t('uploadGarments')} icon={<Shirt />} description={t('selectMultipleGarmentImages')} />
            </div>
            {analyzedRandomGarments.length > 0 && (
              <ScrollArea className="h-24 mt-2 border rounded-md p-2">
                <div className="grid grid-cols-5 gap-2">
                  {analyzedRandomGarments.map((g, i) => <div key={i} className="relative"><img src={g.previewUrl} className="w-full h-full object-cover rounded-md aspect-square" />{g.isAnalyzing && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-white"/></div>}</div>)}
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
          <Tabs defaultValue="one-to-many" onValueChange={(v) => setMode(v as VtoMode)}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="one-to-many">{t('oneGarment')}</TabsTrigger>
              <TabsTrigger value="random-pairs">{t('randomPairs')}</TabsTrigger>
              <TabsTrigger value="precise-pairs">{t('precisePairs')}</TabsTrigger>
              <TabsTrigger value="wardrobe">{t('armadio')}</TabsTrigger>
            </TabsList>
            <TabsContent value="one-to-many" className="pt-6">{renderOneToMany()}</TabsContent>
            <TabsContent value="random-pairs" className="pt-6">{renderRandomPairs()}</TabsContent>
            <TabsContent value="precise-pairs" className="pt-6">{renderPrecisePairs()}</TabsContent>
            <TabsContent value="wardrobe" className="pt-6">
              <Card>
                <CardHeader>
                  <CardTitle>{t('myWardrobe')}</CardTitle>
                  <CardDescription>{t('wardrobeDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoadingWardrobe ? <Skeleton className="h-64 w-full" /> : !wardrobe || wardrobe.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <p>{t('noGarmentsSaved')}</p>
                      <p className="text-xs">{t('noGarmentsSavedDescription')}</p>
                    </div>
                  ) : (
                    <ScrollArea className="h-96">
                      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pr-4">
                        {wardrobe.map(garment => {
                          const isSelected = selectedGarmentIds.has(garment.id);
                          return (
                            <div key={garment.id} className="relative group cursor-pointer" onClick={() => setSelectedGarmentIds(prev => {
                              const newSet = new Set(prev);
                              if (newSet.has(garment.id)) newSet.delete(garment.id);
                              else newSet.add(garment.id);
                              return newSet;
                            })}>
                              <SecureImageDisplay imageUrl={garment.storage_path} alt={garment.name || 'garment'} />
                              {isSelected && <div className="absolute inset-0 bg-primary/70 flex items-center justify-center rounded-md"><CheckCircle className="h-8 w-8 text-primary-foreground" /></div>}
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1 rounded-b-md">
                                <Badge variant={garment.attributes?.intended_gender === 'male' ? 'default' : garment.attributes?.intended_gender === 'female' ? 'destructive' : 'secondary'}>
                                  {garment.attributes?.intended_gender}
                                </Badge>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
        <div className="lg:col-span-1 space-y-6">
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={handleProceed} disabled={isProceedDisabled}>
              {isAnalyzingGarments ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              {isAnalyzingGarments 
                ? "Analyzing Garments..." 
                : t('reviewQueue', { count: queueCount })}
            </Button>
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