import React, { useState, useMemo } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { useQuery } from '@tanstack/react-query';
import { VtoModel, ModelPack, AnalyzedGarment } from '@/types/vto';
import { OneToManyInputs } from './modes/OneToManyInputs';
import { RandomPairsInputs } from './modes/RandomPairsInputs';
import { PrecisePairsInputs } from './modes/PrecisePairsInputs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Loader2, Wand2 } from 'lucide-react';
import { useLanguage } from "@/context/LanguageContext";
import { showError, showSuccess } from '@/utils/toast';
import { calculateFileHash } from '@/lib/utils';
import { isPoseCompatible } from '@/lib/vto-utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ModelPoseSelector } from './ModelPoseSelector';

export interface QueueItem {
  person: { url: string; model_job_id?: string };
  garment: { 
    url: string;
    file?: File;
    analysis?: AnalyzedGarment['analysis']; 
    hash?: string;
  };
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

export const VtoInputProvider = ({ mode, onQueueReady, onGoBack }: VtoInputProviderProps) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
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
  const [isAddingPair, setIsAddingPair] = useState(false);

  const [selectedPackId, setSelectedPackId] = useState<string>('all');
  const [isStrictFiltering, setIsStrictFiltering] = useState(true);

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
        .select('id, base_model_image_url, final_posed_images, gender, target_body_part')
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
          target_body_part: job.target_body_part,
        }))
        .filter(model => model.poses.length > 0);
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
    return true;
  }, [isAnalyzingGarments, mode, selectedModelUrls, analyzedGarment, analyzedRandomGarments, precisePairs]);

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
    if (!file) { setAnalyzedGarment(null); return; }
    
    const tempGarment: AnalyzedGarment = { file, previewUrl: URL.createObjectURL(file), analysis: null, isAnalyzing: true };
    setAnalyzedGarment(tempGarment);

    try {
        const hash = await calculateFileHash(file);
        const { data: existingGarment } = await supabase.from('mira-agent-garments').select('storage_path, attributes, name').eq('user_id', session!.user.id).eq('image_hash', hash).limit(1).maybeSingle();
        if (existingGarment) {
            showSuccess("Found matching garment in your wardrobe.");
            setAnalyzedGarment({ file: undefined, previewUrl: existingGarment.storage_path, analysis: existingGarment.attributes, isAnalyzing: false, hash: hash });
        } else {
            const analysisResult = await analyzeGarment(file);
            setAnalyzedGarment(g => g ? { ...g, analysis: analysisResult, isAnalyzing: false, hash: hash } : null);
        }
    } catch (err: any) {
        showError(`Failed to process garment: ${err.message}`);
        setAnalyzedGarment(null);
    }
  };

  const handleRandomGarmentFilesSelect = async (files: File[]) => {
    const newGarments: AnalyzedGarment[] = files.map(file => ({ file, previewUrl: URL.createObjectURL(file), analysis: null, isAnalyzing: true }));
    setAnalyzedRandomGarments(prev => [...prev, ...newGarments]);

    newGarments.forEach(async (garment) => {
        try {
            const hash = await calculateFileHash(garment.file!);
            const { data: existingGarment } = await supabase.from('mira-agent-garments').select('storage_path, attributes, name').eq('user_id', session!.user.id).eq('image_hash', hash).limit(1).maybeSingle();
            if (existingGarment) {
                showSuccess(`Found matching garment in wardrobe: ${existingGarment.name}`);
                setAnalyzedRandomGarments(prev => prev.map(g => g.file === garment.file ? { ...g, previewUrl: existingGarment.storage_path, analysis: existingGarment.attributes, isAnalyzing: false, hash: hash, file: undefined } : g));
            } else {
                const analysisResult = await analyzeGarment(garment.file!);
                setAnalyzedRandomGarments(prev => prev.map(g => g.file === garment.file ? { ...g, analysis: analysisResult, isAnalyzing: false, hash: hash } : g));
            }
        } catch (err: any) {
            showError(`Failed to process garment ${garment.file!.name}: ${err.message}`);
            setAnalyzedRandomGarments(prev => prev.filter(g => g.file !== garment.file));
        }
    });
  };

  const handleSelectFromWardrobe = (garments: any[]) => {
    const newAnalyzedGarments = garments.map(g => ({ file: undefined, previewUrl: g.storage_path, analysis: g.attributes, isAnalyzing: false, hash: g.image_hash }));
    if (mode === 'one-to-many') setAnalyzedGarment(newAnalyzedGarments[0]);
    else setAnalyzedRandomGarments(prev => [...prev, ...newAnalyzedGarments]);
  };

  const handleMultiModelSelect = (poseUrls: string[]) => {
    setSelectedModelUrls(prev => {
      const newSet = new Set(prev);
      const isSelected = poseUrls.length > 0 && newSet.has(poseUrls[0]);
      if (isSelected) poseUrls.forEach(url => newSet.delete(url));
      else poseUrls.forEach(url => newSet.add(url));
      return newSet;
    });
  };

  const handleSingleModelSelect = (poseUrls: string[]) => {
    if (poseUrls.length > 0) setTempPairPersonUrl(poseUrls[0]);
    setIsModelModalOpen(false);
  };

  const handleUseEntirePack = (models: VtoModel[]) => {
    const allUrls = models.flatMap(model => model.poses.map(p => p.final_url));
    setSelectedModelUrls(new Set(allUrls));
  };

  const addPrecisePair = async () => {
    if (tempPairPersonUrl && tempPairGarmentFile) {
      setIsAddingPair(true);
      const toastId = showLoading("Analyzing garment...");
      try {
        const hash = await calculateFileHash(tempPairGarmentFile);
        const { data: existingGarment } = await supabase.from('mira-agent-garments').select('storage_path, attributes, name').eq('user_id', session!.user.id).eq('image_hash', hash).limit(1).maybeSingle();
        
        let finalAnalysis: AnalyzedGarment['analysis'], finalUrl = URL.createObjectURL(tempPairGarmentFile), finalFile: File | undefined = tempPairGarmentFile;
        if (existingGarment) {
            showSuccess("Found matching garment in wardrobe.");
            finalAnalysis = existingGarment.attributes;
            finalUrl = existingGarment.storage_path;
            finalFile = undefined;
        } else {
            finalAnalysis = await analyzeGarment(tempPairGarmentFile);
        }

        const newPair: QueueItem = {
            person: { url: tempPairPersonUrl },
            garment: { url: finalUrl, file: finalFile, analysis: finalAnalysis, hash: hash },
            appendix: tempPairAppendix
        };
        setPrecisePairs(prev => [...prev, newPair]);
        setTempPairPersonUrl(null);
        setTempPairGarmentFile(null);
        setTempPairAppendix("");
        dismissToast(toastId);
      } catch (err: any) {
        dismissToast(toastId);
        showError(`Failed to add pair: ${err.message}`);
      } finally {
        setIsAddingPair(false);
      }
    }
  };

  const handleProceed = () => {
    let finalQueue: QueueItem[] = [];
    const allSelectedModels = models?.filter(model => model.poses.some(pose => selectedModelUrls.has(pose.final_url))) || [];
    const maleModels = allSelectedModels.filter(m => m.gender === 'male');
    const femaleModels = allSelectedModels.filter(m => m.gender === 'female');

    if (mode === 'one-to-many' && analyzedGarment?.analysis) {
        const garment = analyzedGarment;
        const garmentGender = garment.analysis.intended_gender;
        let targetModels: VtoModel[] = [];
        if (garmentGender === 'male') targetModels = maleModels;
        else if (garmentGender === 'female') targetModels = femaleModels;
        else if (garmentGender === 'unisex') targetModels = [...maleModels, ...femaleModels];

        targetModels.forEach(model => {
            if (isPoseCompatible(garment, model, isStrictFiltering).compatible) {
                model.poses.filter(pose => selectedModelUrls.has(pose.final_url)).forEach(pose => {
                    finalQueue.push({ person: { url: pose.final_url, model_job_id: model.jobId }, garment: { url: garment.previewUrl, file: garment.file, analysis: garment.analysis, hash: garment.hash }, appendix: generalAppendix });
                });
            }
        });
    } else if (mode === 'random-pairs') {
        const maleGarments = analyzedRandomGarments.filter(g => g.analysis?.intended_gender === 'male');
        const femaleGarments = analyzedRandomGarments.filter(g => g.analysis?.intended_gender === 'female');
        const unisexGarments = analyzedRandomGarments.filter(g => g.analysis?.intended_gender === 'unisex');

        const createPairs = (garments: AnalyzedGarment[], models: VtoModel[]) => {
            const numPairs = loopModels ? garments.length : Math.min(garments.length, models.length);
            if (!loopModels && garments.length > models.length) showError(`Cannot pair ${garments.length} garments with only ${models.length} models in strict mode.`);
            for (let i = 0; i < numPairs; i++) {
                const garment = garments[i];
                const model = models[i % models.length];
                if (isPoseCompatible(garment, model, isStrictFiltering).compatible) {
                    model.poses.filter(pose => selectedModelUrls.has(pose.final_url)).forEach(pose => {
                        finalQueue.push({ person: { url: pose.final_url, model_job_id: model.jobId }, garment: { url: garment.previewUrl, file: garment.file, analysis: garment.analysis, hash: garment.hash }, appendix: generalAppendix });
                    });
                }
            }
        };
        createPairs([...maleGarments, ...unisexGarments], maleModels);
        createPairs([...femaleGarments, ...unisexGarments], femaleModels);
    } else if (mode === 'precise-pairs') {
        precisePairs.forEach(pair => {
            const modelForPair = models?.find(m => m.poses.some(p => p.final_url === pair.person.url));
            if (modelForPair) {
                if (isPoseCompatible(pair.garment as any, modelForPair, isStrictFiltering).compatible) {
                    finalQueue.push({ ...pair, person: { ...pair.person, model_job_id: modelForPair.jobId } });
                }
            }
        });
    }

    if (finalQueue.length === 0) {
        showError("No compatible model poses were found for the selected garments. Try disabling 'Strict Pairing' or changing your selection.");
        return;
    }
    onQueueReady(finalQueue);
  };

  const queueCount = useMemo(() => {
    if (mode === 'one-to-many') return selectedModelUrls.size;
    if (mode === 'random-pairs') return analyzedRandomGarments.length * selectedModelUrls.size;
    if (mode === 'precise-pairs') return precisePairs.length;
    return 0;
  }, [mode, selectedModelUrls, analyzedRandomGarments, precisePairs]);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {mode === 'one-to-many' && <OneToManyInputs {...{ models, packs, isLoadingModels, isLoadingPacks, selectedPackId, setSelectedPackId, selectedModelUrls, handleUseEntirePack, analyzedGarment, handleGarmentFileSelect, handleSelectFromWardrobe, setAnalyzedGarment, generalAppendix, setGeneralAppendix, setIsModelModalOpen }} />}
          {mode === 'random-pairs' && <RandomPairsInputs {...{ models, packs, isLoadingModels, isLoadingPacks, selectedPackId, setSelectedPackId, selectedModelUrls, handleUseEntirePack, setIsModelModalOpen, analyzedRandomGarments, handleRandomGarmentFilesSelect, handleSelectFromWardrobe, generalAppendix, setGeneralAppendix, loopModels, setLoopModels }} />}
          {mode === 'precise-pairs' && <PrecisePairsInputs {...{ precisePairs, setPrecisePairs, tempPairPersonUrl, setTempPairPersonUrl, tempPairGarmentFile, setTempPairGarmentFile, tempPairGarmentUrl, tempPairAppendix, setTempPairAppendix, addPrecisePair, setIsModelModalOpen }} />}
        </div>
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>Advanced Settings</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center justify-between p-2 rounded-md">
                <Label htmlFor="strict-pairing-switch" className="flex items-center gap-2">Strict Pairing</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground cursor-help" /></TooltipTrigger>
                    <TooltipContent><p className="max-w-xs">When enabled, the system prevents incompatible pairings (e.g., putting a t-shirt on a model designated for lower-body shots). Disable for more creative freedom.</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Switch id="strict-pairing-switch" checked={isStrictFiltering} onCheckedChange={setIsStrictFiltering} />
              </div>
            </CardContent>
          </Card>
          <div className="flex flex-col gap-2">
            <Button size="lg" onClick={handleProceed} disabled={isProceedDisabled}>
              {isAnalyzingGarments ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {isAnalyzingGarments ? "Analyzing Garments..." : t('reviewQueue', { count: queueCount })}
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
            garmentFilter={mode === 'one-to-many' ? analyzedGarment : null}
            isStrict={isStrictFiltering}
          />
          <DialogFooter><Button onClick={() => setIsModelModalOpen(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};