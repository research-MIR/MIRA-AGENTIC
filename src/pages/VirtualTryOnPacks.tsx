import { useState, useCallback } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { VtoModeSelector } from "@/components/VTO/VtoModeSelector";
import { VtoInputProvider, QueueItem } from "@/components/VTO/VtoInputProvider";
import { VtoReviewQueue } from "@/components/VTO/VtoReviewQueue";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useQueryClient } from "@tanstack/react-query";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Wand2, Loader2, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type WizardStep = 'select-mode' | 'provide-inputs' | 'review-queue';
type VtoMode = 'one-to-many' | 'precise-pairs' | 'random-pairs';

const VirtualTryOnPacks = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<WizardStep>('select-mode');
  const [mode, setMode] = useState<VtoMode | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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

  const uploadFile = async (fileUrl: string, type: 'person' | 'garment') => {
    if (!session?.user) throw new Error("User session not found.");
    
    const response = await fetch(fileUrl);
    const blob = await response.blob();
    const file = new File([blob], "upload.png", { type: blob.type });

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

  const handleGenerate = async () => {
    if (queue.length === 0) return;
    setIsLoading(true);
    const toastId = showLoading(`Queuing ${queue.length} jobs...`);

    const jobPromises = queue.map(async (item) => {
      try {
        const garment_image_url = await uploadFile(item.garment_url, 'garment');
        
        const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
            body: { person_image_url: item.person_url, garment_image_url, prompt_appendix: item.appendix }
        });
        if (promptError) throw promptError;
        const autoPrompt = promptData.final_prompt;

        const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
            body: { 
                person_image_url: item.person_url, 
                garment_image_url, 
                user_id: session?.user?.id, 
                mode: 'base',
                prompt: autoPrompt
            }
        });
        if (error) throw error;
      } catch (err) {
        console.error(`Failed to queue job for person ${item.person_url}:`, err);
      }
    });

    await Promise.all(jobPromises);
    
    dismissToast(toastId);
    showSuccess(`${queue.length} jobs started successfully!`);
    queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session.user.id] });
    setStep('select-mode');
    setQueue([]);
    setMode(null);
    setIsLoading(false);
  };

  const renderStep = () => {
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
        return <VtoInputProvider mode={mode!} onQueueReady={handleQueueReady} onGoBack={handleGoBack} />;
      case 'review-queue':
        return (
          <div className="max-w-2xl mx-auto space-y-6">
            <VtoReviewQueue queue={queue} />
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
        <h1 className="text-3xl font-bold">{t('virtualTryOnPacks')}</h1>
        <p className="text-muted-foreground">{getStepTitle()}</p>
      </header>
      <div className="flex-1 overflow-y-auto">
        {renderStep()}
      </div>
    </div>
  );
};

export default VirtualTryOnPacks;