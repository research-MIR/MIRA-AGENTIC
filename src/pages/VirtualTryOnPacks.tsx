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
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type WizardStep = 'select-mode' | 'provide-inputs' | 'review-queue';
type VtoMode = 'one-to-many' | 'precise-pairs' | 'random-pairs';

const aspectRatioOptions = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "3:2", "2:3", "4:5", "5:4"];

const VirtualTryOnPacks = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>('select-mode');
  const [mode, setMode] = useState<VtoMode | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<string>("1:1");
  const [skipReframe, setSkipReframe] = useState(false);

  const handleSelectMode = (selectedMode: VtoMode) => {
    setMode(selectedMode);
    setStep('provide-inputs');
  };

  const handleQueueReady = (newQueue: QueueItem[]) => {
    setQueue(newQueue);
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
        // A person URL is always pre-existing from the model generation step
        const person_url = item.person.url;
        
        // A garment URL is either from an existing Armadio item (storage_path) or needs to be created by uploading a new file
        const garment_url = item.garment.file 
            ? await uploadFile(item.garment.file, 'garment') 
            : item.garment.url;
        
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
    </div>
  );
};

export default VirtualTryOnPacks;