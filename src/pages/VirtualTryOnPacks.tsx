import { useState, useCallback } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { VtoModeSelector } from "@/components/VTO/VtoModeSelector";
import { VtoInputProvider, QueueItem } from "@/components/VTO/VtoInputProvider";
import { VtoReviewQueue } from "@/components/VTO/VtoReviewQueue";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useQueryClient } from "@tanstack/react-query";
import { Wand2, Loader2, Info, History } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RecentVtoPacks } from "@/components/VTO/RecentVtoPacks";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type WizardStep = 'select-mode' | 'provide-inputs' | 'review-queue';
type VtoMode = 'one-to-many' | 'precise-pairs' | 'random-pairs';
type Engine = 'google' | 'bitstudio';

const VirtualTryOnPacks = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>('select-mode');
  const [mode, setMode] = useState<VtoMode | null>(null);
  const [engine, setEngine] = useState<Engine>('bitstudio');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [aspectRatio, setAspectRatio] = useState("4:5");
  const [scenePrompt, setScenePrompt] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSelectMode = (selectedMode: VtoMode) => {
    setMode(selectedMode);
    setStep('provide-inputs');
  };

  const handleQueueReady = (newQueue: QueueItem[], newAspectRatio: string, newScenePrompt: string) => {
    setQueue(newQueue);
    setAspectRatio(newAspectRatio);
    setScenePrompt(newScenePrompt);
    setStep('review-queue');
  };

  const handleGoBack = () => {
    if (step === 'provide-inputs') {
      setStep('select-mode');
    } else if (step === 'review-queue') {
      setStep('provide-inputs');
    }
  };

  const handleGenerate = async () => {
    if (queue.length === 0) return;
    setIsLoading(true);
    const toastId = showLoading(`Uploading assets and queuing ${queue.length} jobs...`);

    try {
      const uploadFile = async (file: File, type: 'person' | 'garment') => {
        if (!session?.user) throw new Error("User session not found.");
        const filePath = `${session.user.id}/vto-source/${type}-${Date.now()}-${file.name}`;
        
        const { error } = await supabase.storage
          .from('mira-agent-user-uploads')
          .upload(filePath, file);
        
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
          appendix: item.appendix
        };
      }));

      const { error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-vto-packs', {
        body: {
          pairs: pairsForBackend,
          user_id: session?.user?.id,
          engine: engine,
          aspect_ratio: aspectRatio,
          scene_prompt: scenePrompt,
        }
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess(`${queue.length} jobs have been queued for processing.`);
      queryClient.invalidateQueries({ queryKey: ['recentVtoPacks'] });
      setStep('select-mode');
      setQueue([]);
      setMode(null);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to queue batch job: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const renderCreateStep = () => {
    switch (step) {
      case 'select-mode':
        return (
          <div className="flex flex-col items-center justify-center h-full">
            <Alert className="max-w-2xl mb-8">
              <Info className="h-4 w-4" />
              <AlertTitle>{t('vtoPacksIntroTitle')}</AlertTitle>
              <AlertDescription>{t('vtoPacksIntroDescription')}</AlertDescription>
            </Alert>
            <VtoModeSelector onSelectMode={handleSelectMode} />
          </div>
        );
      case 'provide-inputs':
        return <VtoInputProvider 
                  mode={mode!} 
                  onQueueReady={handleQueueReady} 
                  onGoBack={handleGoBack}
                />;
      case 'review-queue':
        return (
          <div className="max-w-2xl mx-auto space-y-6">
            <VtoReviewQueue queue={queue} />
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Ready to Generate</AlertTitle>
              <AlertDescription>
                You are about to generate {queue.length} images using the <strong>{engine}</strong> engine with aspect ratio <strong>{aspectRatio}</strong>.
              </AlertDescription>
            </Alert>
            <div className="flex justify-between items-center">
              <Button variant="outline" onClick={handleGoBack}>{t('goBack')}</Button>
              <Button size="lg" onClick={handleGenerate} disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                {t('generateNImages', { count: queue.length })}
              </Button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case 'select-mode': return t('step1Title');
      case 'provide-inputs': return t('step2Title');
      case 'review-queue': return t('step3Title');
      default: return '';
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-4 border-b shrink-0">
        <div className="flex justify-between items-center">
            <div>
                <h1 className="text-3xl font-bold">{t('virtualTryOnPacks')}</h1>
                <p className="text-muted-foreground">{getStepTitle()}</p>
            </div>
            <div className="flex items-center gap-4">
                <Label>{t('engine')}</Label>
                <RadioGroup value={engine} onValueChange={(v) => setEngine(v as any)} className="flex items-center space-x-2 border p-1 rounded-md">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Label htmlFor="bitstudio-engine" className="flex items-center space-x-2 p-2 rounded-sm has-[:checked]:bg-muted cursor-pointer">
                                    <RadioGroupItem value="bitstudio" id="bitstudio-engine" />
                                    <span>{t('bitstudioVTO')}</span>
                                </Label>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{t('bitstudioVTODescription')}</p>
                            </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Label htmlFor="google-engine" className="flex items-center space-x-2 p-2 rounded-sm has-[:checked]:bg-muted cursor-pointer">
                                    <RadioGroupItem value="google" id="google-engine" />
                                    <span>{t('googleVTO')}</span>
                                </Label>
                            </TooltipTrigger>
                            <TooltipContent>
                                <p>{t('googleVTODescription')}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </RadioGroup>
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
            <RecentVtoPacks engine={engine} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default VirtualTryOnPacks;