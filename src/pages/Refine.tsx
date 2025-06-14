import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadCloud, Wand2, Loader2, GitCompareArrows, Info, Sparkles } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/context/LanguageContext";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Slider } from "@/components/ui/slider";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";

interface ComfyJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: { publicUrl: string, storagePath: string };
  error_message?: string;
}

const Refine = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const { showImage } = useImagePreview();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeJob, setActiveJob] = useState<ComfyJob | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [upscaleFactor, setUpscaleFactor] = useState(1.4);
  const [originalDimensions, setOriginalDimensions] = useState<{ width: number; height: number } | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [comparisonImages, setComparisonImages] = useState<{ before: string; after: string } | null>(null);
  const [isAutoPromptEnabled, setIsAutoPromptEnabled] = useState(true);
  const [isLoadingAutoPrompt, setIsLoadingAutoPrompt] = useState(false);

  const { data: activeComfyJobs, isLoading: isLoadingJobs } = useQuery({
    queryKey: ['activeComfyJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-comfyui-jobs')
        .select('*')
        .eq('user_id', session.user.id)
        .in('status', ['queued', 'processing'])
        .order('created_at', { ascending: false });
      if (error) {
        console.error("Error fetching active jobs:", error);
        return [];
      }
      return data as ComfyJob[];
    },
    enabled: !!session?.user,
    refetchInterval: 30000,
  });

  const isThisPageJobRunning = useMemo(() => {
    return activeJob && (activeJob.status === 'queued' || activeJob.status === 'processing');
  }, [activeJob]);

  const isAnyJobRunning = useMemo(() => {
    return activeComfyJobs && activeComfyJobs.length > 0;
  }, [activeComfyJobs]);

  const showCancelButton = isAnyJobRunning && !isThisPageJobRunning;

  const sourceImageUrl = useMemo(() => {
    if (sourceImageFile) return URL.createObjectURL(sourceImageFile);
    return null;
  }, [sourceImageFile]);

  const subscribeToJobUpdates = useCallback((jobId: string) => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }
    
    channelRef.current = supabase.channel(`comfyui-job-${jobId}`)
      .on<ComfyJob>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mira-agent-comfyui-jobs', filter: `id=eq.${jobId}` },
        async (payload) => {
          const newJob = payload.new as ComfyJob;
          setActiveJob(newJob);
          if (newJob.status === 'complete' && newJob.final_result) {
            showSuccess("Refinement complete!");
            if (sourceImageUrl) {
              setComparisonImages({ before: sourceImageUrl, after: newJob.final_result.publicUrl });
            }
            queryClient.invalidateQueries({ queryKey: ['generatedImages'] });
            supabase.removeChannel(channelRef.current!);
            channelRef.current = null;
          } else if (newJob.status === 'failed') {
            showError(`Job failed: ${newJob.error_message}`);
            supabase.removeChannel(channelRef.current!);
            channelRef.current = null;
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') console.log(`[RefinePage] Subscribed to job ${jobId}`);
        if (status === 'CHANNEL_ERROR') showError(`Realtime connection failed: ${err?.message}`);
      });
  }, [supabase, sourceImageUrl, queryClient]);

  useEffect(() => {
    if (activeComfyJobs && activeComfyJobs.length > 0 && !activeJob) {
      const jobToTrack = activeComfyJobs[0];
      console.log(`[RefinePage] Found active job ${jobToTrack.id}, resuming tracking.`);
      setActiveJob(jobToTrack);
      subscribeToJobUpdates(jobToTrack.id);
    }
  }, [activeComfyJobs, activeJob, subscribeToJobUpdates]);

  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [supabase]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSourceImageFile(file);
      setActiveJob(null);
      setComparisonImages(null);
      setPrompt("");

      const reader = new FileReader();
      reader.onload = (event) => {
          const img = new Image();
          img.onload = () => {
              setOriginalDimensions({ width: img.width, height: img.height });
              if (isAutoPromptEnabled) {
                handleAutoPrompt(event.target?.result as string, file.type);
              }
          };
          img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    } else {
        setOriginalDimensions(null);
        setSourceImageFile(null);
    }
  };

  const handleAutoPrompt = async (dataUrl: string, mimeType: string) => {
    setIsLoadingAutoPrompt(true);
    const toastId = showLoading("Analyzing image to create prompt...");
    try {
      const base64 = dataUrl.split(',')[1];
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-auto-describe-image', {
        body: { base64_image_data: base64, mime_type: mimeType }
      });
      if (error) throw error;
      setPrompt(data.auto_prompt);
      dismissToast(toastId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Auto-prompt failed: ${err.message}`);
    } finally {
      setIsLoadingAutoPrompt(false);
    }
  };

  const handleRefine = async () => {
    if (!sourceImageFile) return showError("Per favore, carica un'immagine sorgente.");
    if (!prompt.trim()) return showError("Per favore, inserisci un prompt di affinamento.");
    if (!session?.user) return showError("Devi essere loggato per usare questa funzione.");

    setIsLoading(true);
    setActiveJob({ id: '', status: 'queued' });
    setComparisonImages(null);
    const loadingMessage = isAutoPromptEnabled ? t.generatingAndSendingJob : t.sendingJob;
    let toastId = showLoading(loadingMessage);

    try {
      const formData = new FormData();
      formData.append('image', sourceImageFile);
      formData.append('prompt_text', prompt);
      formData.append('invoker_user_id', session.user.id);
      formData.append('upscale_factor', String(upscaleFactor));
      formData.append('original_prompt_for_gallery', `Refined: ${prompt.slice(0, 40)}...`);

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: formData
      });

      if (error) throw error;
      
      const { jobId } = data;
      if (!jobId) throw new Error("Non è stato ricevuto un ID job dal server.");
      
      dismissToast(toastId);
      showSuccess("Job ComfyUI accodato. In attesa del risultato...");
      setActiveJob({ id: jobId, status: 'queued' });
      subscribeToJobUpdates(jobId);

    } catch (err: any) {
      setActiveJob(null);
      showError(`Errore: ${err.message}`);
      console.error("[Refine] Error:", err);
      dismissToast(toastId);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelAndStartNew = async () => {
    if (!session?.user) return;
    const toastId = showLoading("Cancellazione del job attivo...");
    try {
      const { error: cancelError } = await supabase.rpc('cancel_active_comfyui_jobs', { p_user_id: session.user.id });
      if (cancelError) throw new Error(`Impossibile cancellare i job attivi: ${cancelError.message}`);
      
      await queryClient.invalidateQueries({ queryKey: ['activeComfyJobs', session.user.id] });
      
      dismissToast(toastId);
      showSuccess("Job attivo cancellato. Avvio del nuovo affinamento...");

      await handleRefine();

    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    }
  };

  const renderJobStatus = () => {
    if (!activeJob) return null;

    switch (activeJob.status) {
      case 'queued':
        return <div className="flex items-center justify-center h-full"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> In coda...</div>;
      case 'processing':
        return <div className="flex items-center justify-center h-full"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> In elaborazione...</div>;
      case 'complete':
        return activeJob.final_result?.publicUrl ? (
          <button onClick={() => showImage({ images: [{ url: activeJob.final_result!.publicUrl }], currentIndex: 0 })} className="block w-full h-full">
            <img src={activeJob.final_result.publicUrl} alt="Refined by ComfyUI" className="rounded-lg aspect-square object-contain w-full hover:opacity-80 transition-opacity" />
          </button>
        ) : <p>Job completato, ma nessun URL immagine trovato.</p>;
      case 'failed':
        return <p className="text-destructive">Job fallito: {activeJob.error_message}</p>;
      default:
        return null;
    }
  };

  const refineButton = (
    <Button 
      onClick={handleRefine} 
      disabled={isLoading || !sourceImageFile || isAnyJobRunning} 
      className="w-full"
    >
      {isThisPageJobRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
      {isAutoPromptEnabled ? t.generateAndRefine : t.refineButton}
    </Button>
  );

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">{t.refineAndUpscale}</h1>
            <p className="text-muted-foreground">{t.refinePageDescription}</p>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader><CardTitle>{t.sourceImage}</CardTitle></CardHeader>
              <CardContent>
                <Input id="source-image-upload" type="file" accept="image/*" onChange={handleFileChange} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t.refinementPrompt}</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center justify-between mb-4">
                  <Label htmlFor="auto-prompt-switch" className="flex flex-col space-y-1">
                    <span>Auto-Prompt</span>
                    <span className="font-normal leading-snug text-muted-foreground text-sm">
                      Generate a detailed prompt from your image automatically.
                    </span>
                  </Label>
                  <Switch
                    id="auto-prompt-switch"
                    checked={isAutoPromptEnabled}
                    onCheckedChange={setIsAutoPromptEnabled}
                  />
                </div>
                {isAutoPromptEnabled ? (
                  <div className="p-3 border rounded-md bg-muted min-h-[108px] text-sm">
                    {isLoadingAutoPrompt ? (
                      <div className="flex items-center text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing...</div>
                    ) : prompt ? (
                      <p className="font-mono text-xs">{prompt}</p>
                    ) : (
                      <p className="text-muted-foreground">Upload an image to generate an automatic prompt.</p>
                    )}
                  </div>
                ) : (
                  <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t.refinementPromptPlaceholder} rows={4} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t.upscaleSettings}</CardTitle></CardHeader>
              <CardContent>
                  <div className="space-y-2">
                      <Label>{t.upscaleFactor}: {upscaleFactor.toFixed(1)}x</Label>
                      <Slider
                          value={[upscaleFactor]}
                          onValueChange={(value) => setUpscaleFactor(value[0])}
                          min={1}
                          max={4}
                          step={0.1}
                          disabled={!sourceImageFile}
                      />
                      {originalDimensions && (
                          <p className="text-sm text-muted-foreground text-center">
                              {originalDimensions.width}x{originalDimensions.height} → 
                              {' '}{Math.round(originalDimensions.width * upscaleFactor)}x{Math.round(originalDimensions.height * upscaleFactor)}
                          </p>
                      )}
                  </div>
              </CardContent>
            </Card>
            {showCancelButton ? (
              <div className="flex gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-full">{refineButton}</div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Attendi il completamento dell'altro tuo lavoro di affinamento.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <Button variant="destructive" onClick={handleCancelAndStartNew}>
                  {t.cancelAndStartNew}
                </Button>
              </div>
            ) : (
              refineButton
            )}
          </div>

          <div className="lg:col-span-2">
            <Card className="min-h-[60vh]">
              <CardHeader><CardTitle>{t.results}</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <h3 className="font-semibold mb-2 text-center">{t.originalImage}</h3>
                      {sourceImageUrl ? (
                          <button onClick={() => showImage({ images: [{ url: sourceImageUrl }], currentIndex: 0 })} className="block w-full h-full">
                              <img src={sourceImageUrl} alt="Original" className="rounded-lg aspect-square object-contain w-full hover:opacity-80 transition-opacity" />
                          </button>
                      ) : isThisPageJobRunning ? (
                          <div className="aspect-square bg-muted rounded-lg flex flex-col items-center justify-center text-muted-foreground text-center p-4">
                            <Info className="h-12 w-12 mb-4" />
                            <p>Job in corso... L'immagine originale non è disponibile per le sessioni riprese.</p>
                          </div>
                      ) : (
                          <div className="aspect-square bg-muted rounded-lg flex flex-col items-center justify-center text-muted-foreground">
                              <UploadCloud className="h-12 w-12 mb-4" />
                              <p>{t.uploadAnImageToStart}</p>
                          </div>
                      )}
                  </div>
                  <div>
                      <h3 className="font-semibold mb-2 text-center">{t.refinedImage}</h3>
                      <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                          {isLoading && !activeJob ? <Skeleton className="h-full w-full" /> : renderJobStatus()}
                          {!isLoading && !activeJob && <p className="text-muted-foreground text-center p-4">Il risultato apparirà qui.</p>}
                      </div>
                  </div>
              </CardContent>
            </Card>
            {comparisonImages && (
              <Button onClick={() => setIsCompareModalOpen(true)} className="mt-4 w-full">
                <GitCompareArrows className="mr-2 h-4 w-4" />
                {t.compareResults}
              </Button>
            )}
          </div>
        </div>
      </div>
      {comparisonImages && (
        <ImageCompareModal
          isOpen={isCompareModalOpen}
          onClose={() => setIsCompareModalOpen(false)}
          beforeUrl={comparisonImages.before}
          afterUrl={comparisonImages.after}
        />
      )}
    </>
  );
};

export default Refine;