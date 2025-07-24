import React, { useState, useMemo, useRef, useEffect } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { VtoReviewQueue, QueueItem } from "@/components/VTO/VtoReviewQueue";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Wand2, Loader2, Info, History, Shirt, Users, Link2, Shuffle, Library, PlusCircle, X, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RecentVtoPacks } from "@/components/VTO/RecentVtoPacks";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ModelPoseSelector, VtoModel, ModelPack } from '@/components/VTO/ModelPoseSelector';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useDropzone } from "@/hooks/useDropzone";
import { Skeleton } from "@/components/ui/skeleton";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { CheckCircle } from "lucide-react";

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

type VtoMode = 'one-to-many' | 'random-pairs' | 'precise-pairs' | 'wardrobe';
const aspectRatioOptions = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "3:2", "2:3", "4:5", "5:4"];

const VirtualTryOnPacks = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [showReview, setShowReview] = useState(false);
  const [mode, setMode] = useState<VtoMode>('one-to-many');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [skipReframe, setSkipReframe] = useState(false);

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
    if (mode === 'one-to-many') return analyzedGarment?.isAnalyzing ?? false;
    if (mode === 'random-pairs') return analyzedRandomGarments.some(g => g.isAnalyzing);
    return false;
  }, [mode, analyzedGarment, analyzedRandomGarments]);

  const isProceedDisabled = useMemo(() => {
    if (isAnalyzingGarments) return true;
    if (mode === 'one-to-many') return selectedModelUrls.size === 0 || !analyzedGarment || !analyzedGarment.analysis;
    if (mode === 'random-pairs') return selectedModelUrls.size === 0 || analyzedRandomGarments.length === 0 || analyzedRandomGarments.some(g => !g.analysis);
    if (mode === 'precise-pairs') return precisePairs.length === 0;
    if (mode === 'wardrobe') return selectedModelUrls.size === 0 || selectedGarmentIds.size === 0;
    return true;
  }, [isAnalyzingGarments, mode, selectedModelUrls, analyzedGarment, analyzedRandomGarments, precisePairs, selectedGarmentIds]);

  const analyzeGarment = async (file: File): Promise<AnalyzedGarment['analysis']> => {
    try {
        const base64 = await fileToBase64(file);
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-analyze-garment-attributes', {
            body: { image_base64: base64, mime_type: file.type }
        });
        if (error) throw error;
        return data;
    } catch (err) {
        console.error(`Failed to analyze garment ${file.name}:`, err);
        return null;
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
    setQueue(queue);
    setShowReview(true);
  };

  const handleGenerate = async () => {
    if (queue.length === 0) return;
    setIsLoading(true);
    const toastId = showLoading(`Uploading assets and queuing ${queue.length} jobs...`);

    try {
      const uploadFile = async (file: File, type: 'person' | 'garment') => {
        if (!session?.user) throw new Error("User session not found.");
        const optimizedFile = await optimizeImage(file);
        const sanitizedName = sanitizeFilename(optimizedFile.name);
        const filePath = `${session.user.id}/vto-source/${type}-${Date.now()}-${sanitizedName}`;
        
        const { error } = await supabase.storage
          .from('mira-agent-user-uploads')
          .upload(filePath, optimizedFile);
        
        if (error) throw new Error(`Failed to upload ${type} image: ${error.message}`);
        
        const { data: { publicUrl } } = supabase.storage
          .from('mira-agent-user-uploads')
          .getPublicUrl(filePath);
          
        return publicUrl;
      };

      const pairsForBackend = await Promise.all(queue.map(async (item) => {
        const person_url = item.person.file ? await uploadFile(item.person.file, 'person') : item.person.url;
        const garment_url = await uploadFile(item.garment.file, 'garment');
        
        return {
          person_url,
          garment_url,
          appendix: item.appendix,
          metadata: {
            model_generation_job_id: item.person.model_job_id,
            garment_analysis: item.garment.analysis,
          }
        };
      }));

      const { error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-vto-packs', {
        body: {
          pairs: pairsForBackend,
          user_id: session?.user?.id,
          engine: 'google',
          aspect_ratio: aspectRatio,
          skip_reframe: skipReframe,
        }
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess(`${queue.length} jobs have been queued for processing.`);
      queryClient.invalidateQueries({ queryKey: ['recentVtoPacks'] });
      setShowReview(false);
      setQueue([]);
      setMode('one-to-many');
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to queue batch job: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const renderCreateStep = () => {
    if (showReview) {
      return (
        <div className="max-w-2xl mx-auto space-y-6">
          <VtoReviewQueue queue={queue} />
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="skip-reframe-switch" className="flex items-center gap-2">
                  {t('skipReframe')}
                </Label>
                <Switch id="skip-reframe-switch" checked={skipReframe} onCheckedChange={setSkipReframe} />
              </div>
              <p className="text-xs text-muted-foreground">{t('skipReframeDescription')}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-2">
              <Label htmlFor="aspect-ratio-final" className={cn(skipReframe && "text-muted-foreground")}>{t('aspectRatio')}</Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio} disabled={skipReframe}>
                <SelectTrigger id="aspect-ratio-final">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {aspectRatioOptions.map(ratio => (
                    <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {skipReframe ? t('aspectRatioDisabled') : t('aspectRatioDescription')}
              </p>
            </CardContent>
          </Card>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Ready to Generate</AlertTitle>
            <AlertDescription>
              You are about to generate {queue.length} images using the <strong>Google VTO</strong> engine.
            </AlertDescription>
          </Alert>
          <div className="flex justify-between items-center">
            <Button variant="outline" onClick={() => setShowReview(false)}>{t('goBack')}</Button>
            <Button size="lg" onClick={handleGenerate} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {t('generateNImages', { count: queue.length })}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Tabs value={mode} onValueChange={(v) => setMode(v as VtoMode)}>
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
                : t('reviewQueue', { count: precisePairs.length })}
            </Button>
            <Button variant="outline" onClick={onGoBack}>{t('goBack')}</Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-4 border-b shrink-0">
        <div className="flex justify-between items-center">
            <div>
                <h1 className="text-3xl font-bold">{t('virtualTryOnPacks')}</h1>
                <p className="text-muted-foreground">{showReview ? t('step3Title') : t('step2Title')}</p>
            </div>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="create">{t('createBatch')}</TabsTrigger>
            <TabsTrigger value="recent">{t('recentJobs')}</TabsTrigger>
          </TabsList>
          <TabsContent value="create" className="pt-6">
            {renderCreateStep()}
          </TabsContent>
          <TabsContent value="recent" className="pt-6">
            <RecentVtoPacks />
          </TabsContent>
        </Tabs>
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

export default VirtualTryOnPacks;