import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Image as ImageIcon, Sparkles, Wand2, UploadCloud, X, PlusCircle, AlertTriangle, CheckCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { RecentJobThumbnail } from "@/components/Jobs/RecentJobThumbnail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface VtoPipelineJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: {
    publicUrl: string;
  };
  metadata?: {
    source_image_url?: string;
  };
}

const SecureDisplayImage = ({ imageUrl, onClear, showClearButton = false }: { imageUrl: string | null, onClear?: () => void, showClearButton?: boolean }) => {
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl);

  if (!imageUrl) return null;

  return (
    <div className="relative w-full h-full">
      {isLoading && <Skeleton className="w-full h-full" />}
      {error && <div className="w-full h-full bg-destructive/10 rounded-md flex items-center justify-center text-destructive text-sm p-2"><AlertTriangle className="h-6 w-6 mr-2" />Error loading image.</div>}
      {displayUrl && <img src={displayUrl} alt="Source for refinement" className="w-full h-full object-contain" />}
      {showClearButton && onClear && (
        <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 rounded-full" onClick={onClear}>
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
};

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

const Refine = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { uploadedFiles, setUploadedFiles, handleFileUpload } = useFileUpload();

  const [prompt, setPrompt] = useState("");
  const [upscaleFactor, setUpscaleFactor] = useState(1.5);
  const [useAutoPrompt, setUseAutoPrompt] = useState(true);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptReady, setPromptReady] = useState(false);
  const [openAccordion, setOpenAccordion] = useState("");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery<VtoPipelineJob[]>({
    queryKey: ['recentRefinerJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-comfyui-jobs')
        .select('id, status, final_result, metadata')
        .eq('metadata->>source', 'refiner')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => recentJobs?.find(j => j.id === selectedJobId), [recentJobs, selectedJobId]);

  const sourceImageUrl = useMemo(() => {
    if (selectedJob) return selectedJob.metadata?.source_image_url;
    if (uploadedFiles.length > 0) return uploadedFiles[0].previewUrl;
    return null;
  }, [selectedJob, uploadedFiles]);

  const resultImageUrl = useMemo(() => {
    return selectedJob?.status === 'complete' ? selectedJob.final_result?.publicUrl : null;
  }, [selectedJob]);

  const handleGeneratePrompt = async () => {
    if (uploadedFiles.length === 0) return showError("Please upload an image first.");
    setIsGeneratingPrompt(true);
    setPromptReady(false);
    const toastId = showLoading("Generating prompt from image...");
    try {
      const file = uploadedFiles[0].file;
      const base64Data = await fileToBase64(file);

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-auto-describe-image', {
        body: { base64_image_data: base64Data, mime_type: file.type }
      });
      if (error) throw error;
      setPrompt(data.auto_prompt);
      setPromptReady(true);
      dismissToast(toastId);
      showSuccess("Prompt generated!");
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to generate prompt: ${err.message}`);
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const startNew = () => {
    setSelectedJobId(null);
    setUploadedFiles([]);
    setPrompt("");
    setPromptReady(false);
    setOpenAccordion("");
  };

  const handleSubmit = async () => {
    if (!sourceImageUrl) return showError("Please upload or select an image to refine.");
    if (!prompt.trim()) return showError("Please provide a refinement prompt.");
    
    setIsSubmitting(true);
    let toastId = showLoading("Submitting job...");

    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000; // 2 seconds

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const payload: any = {
                prompt_text: prompt,
                invoker_user_id: session?.user?.id,
                upscale_factor: upscaleFactor,
                original_prompt_for_gallery: prompt,
                source: 'refiner',
            };

            if (sourceImageUrl.startsWith('blob:')) {
                const file = uploadedFiles[0].file;
                payload.base64_image_data = await fileToBase64(file);
                payload.mime_type = file.type;
                payload.metadata = { source_image_url: sourceImageUrl };
            } else {
                payload.image_url = sourceImageUrl;
                payload.metadata = { source_image_url: sourceImageUrl };
            }

            const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', { body: payload });

            if (error) throw error;
            
            dismissToast(toastId);
            showSuccess("Refinement job started! You can track its progress in the sidebar.");
            queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
            queryClient.invalidateQueries({ queryKey: ['recentRefinerJobs'] });
            startNew();
            setIsSubmitting(false);
            return; // Exit the loop on success
        } catch (err: any) {
            dismissToast(toastId);
            if (attempt < MAX_RETRIES) {
                toastId = showLoading(`Submission failed. Retrying... (${attempt}/${MAX_RETRIES})`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            } else {
                showError(`Job submission failed after ${MAX_RETRIES} attempts: ${err.message}`);
                setIsSubmitting(false);
            }
        }
    }
  };

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">{t('refineAndUpscale')}</h1>
          <p className="text-muted-foreground">{t('refinePageDescription')}</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader><CardTitle>{t('sourceImage')}</CardTitle></CardHeader>
              <CardContent>
                {sourceImageUrl ? (
                  <div className="max-w-sm mx-auto">
                    <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center">
                      <SecureDisplayImage imageUrl={sourceImageUrl} onClear={startNew} showClearButton={true} />
                    </div>
                  </div>
                ) : (
                  <div className="p-4 border-2 border-dashed rounded-lg text-center">
                    <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
                    <Label htmlFor="refine-upload" className="mt-2 text-sm font-medium text-primary underline cursor-pointer">{t('uploadAFile')}</Label>
                    <p className="text-xs text-muted-foreground">{t('dragAndDrop')}</p>
                    <Input id="refine-upload" type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e.target.files)} />
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('refinementPrompt')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch id="auto-prompt" checked={useAutoPrompt} onCheckedChange={(checked) => {
                    setUseAutoPrompt(checked);
                    if (!checked) {
                      setPrompt("");
                      setPromptReady(false);
                    }
                  }} />
                  <Label htmlFor="auto-prompt">{t('autoPrompt')}</Label>
                </div>
                {useAutoPrompt ? (
                  <>
                    <Button className="w-full" onClick={handleGeneratePrompt} disabled={isGeneratingPrompt || promptReady || uploadedFiles.length === 0}>
                      {isGeneratingPrompt ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating...</>
                        : promptReady ? <><CheckCircle className="mr-2 h-4 w-4" /> Prompt Ready</>
                        : <><Sparkles className="mr-2 h-4 w-4" /> Generate Prompt</>
                      }
                    </Button>
                    {prompt && (
                      <Accordion type="single" collapsible className="w-full" value={openAccordion} onValueChange={(value) => { setOpenAccordion(value); if (value) setPromptReady(false); }}>
                        <AccordionItem value="item-1">
                          <AccordionTrigger className={cn(promptReady && "text-primary animate-pulse")}>View Generated Prompt</AccordionTrigger>
                          <AccordionContent>
                            <p className="text-sm p-2 bg-muted rounded-md">{prompt}</p>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    )}
                  </>
                ) : (
                  <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('refinementPromptPlaceholder')} />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('upscaleSettings')}</CardTitle></CardHeader>
              <CardContent>
                <Label>{t('upscaleFactor')}: {upscaleFactor}x</Label>
                <Slider value={[upscaleFactor]} onValueChange={(v) => setUpscaleFactor(v[0])} min={1} max={3} step={0.1} />
              </CardContent>
            </Card>
            <Button size="lg" className="w-full" onClick={handleSubmit} disabled={isSubmitting || !sourceImageUrl || !prompt}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {t('refineButton')}
            </Button>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>{t('workbench')}</CardTitle>
                  {selectedJob && <Button variant="outline" onClick={startNew}>{t('startNewJob')}</Button>}
                </div>
                <p className="text-sm text-muted-foreground">{t('refineWorkbenchTooltip')}</p>
              </CardHeader>
              <CardContent className="min-h-[400px]">
                {selectedJob ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">{t('originalImage')}</h3>
                        <SecureDisplayImage imageUrl={selectedJob.metadata?.source_image_url || null} />
                      </div>
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">{t('refinedImage')}</h3>
                        {resultImageUrl ? (
                          <SecureDisplayImage imageUrl={resultImageUrl} />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <p className="mt-2 text-sm">{t('inProgress')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {resultImageUrl && (
                      <Button className="w-full mt-4" onClick={() => setIsCompareModalOpen(true)}>{t('compareResults')}</Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <ImageIcon className="h-16 w-16" />
                    <p className="mt-4 text-center">{t('uploadOrSelect')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('recentRefinements')}</CardTitle></CardHeader>
              <CardContent>
                {isLoadingRecent ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
                  <ScrollArea className="h-32">
                    <div className="flex gap-4 pb-2">
                      {recentJobs.map(job => (
                        <RecentJobThumbnail
                          key={job.id}
                          job={job}
                          onClick={() => setSelectedJobId(job.id)}
                          isSelected={selectedJobId === job.id}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('noRecentJobs')}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      {isCompareModalOpen && sourceImageUrl && resultImageUrl && (
        <ImageCompareModal 
          isOpen={isCompareModalOpen}
          onClose={() => setIsCompareModalOpen(false)}
          beforeUrl={sourceImageUrl}
          afterUrl={resultImageUrl}
        />
      )}
    </>
  );
};

export default Refine;