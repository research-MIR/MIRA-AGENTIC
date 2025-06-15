import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadCloud, Wand2, Loader2, GitCompareArrows, X } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/context/LanguageContext";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Slider } from "@/components/ui/slider";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";

interface ComfyJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: { publicUrl: string, storagePath: string };
  error_message?: string;
  metadata?: {
    source_image_url?: string;
    prompt?: string;
  };
}

const Refine = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const { showImage } = useImagePreview();
  const queryClient = useQueryClient();
  
  const [selectedJob, setSelectedJob] = useState<ComfyJob | null>(null);
  const [prompt, setPrompt] = useState("");
  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null);
  const [upscaleFactor, setUpscaleFactor] = useState(1.4);
  const [isAutoPromptEnabled, setIsAutoPromptEnabled] = useState(true);
  const [isQueueing, setIsQueueing] = useState(false);
  const [isLoadingAutoPrompt, setIsLoadingAutoPrompt] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [originalDimensions, setOriginalDimensions] = useState<{ width: number; height: number } | null>(null);

  const { data: recentJobs, isLoading: isLoadingRecentJobs } = useQuery<ComfyJob[]>({
    queryKey: ['recentRefinementJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-comfyui-jobs')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('metadata->>source', 'refiner')
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const sourceImageUrl = useMemo(() => {
    if (selectedJob) return selectedJob.metadata?.source_image_url;
    if (sourceImageFile) return URL.createObjectURL(sourceImageFile);
    return null;
  }, [selectedJob, sourceImageFile]);

  const resetToNewJobState = () => {
    setSelectedJob(null);
    setSourceImageFile(null);
    setPrompt("");
    setOriginalDimensions(null);
  };

  const handleFileChange = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      if (file.type.startsWith('video/') || file.type === 'image/avif') {
        showError("Unsupported file type. AVIF and video formats are not allowed.");
        return;
      }
      resetToNewJobState();
      setSourceImageFile(file);

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
    }
  }, [isAutoPromptEnabled]);

  const { isDraggingOver, dropzoneProps } = useDropzone({ onDrop: handleFileChange });

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
    if (!sourceImageFile) return showError("Please upload a source image to start a new job.");
    if (!prompt.trim()) return showError("Please enter a refinement prompt.");
    if (!session?.user) return showError("You must be logged in to use this feature.");

    setIsQueueing(true);
    const toastId = showLoading(t.sendingJob);

    try {
      const formData = new FormData();
      formData.append('image', sourceImageFile);
      formData.append('prompt_text', prompt);
      formData.append('invoker_user_id', session.user.id);
      formData.append('upscale_factor', String(upscaleFactor));
      formData.append('source', 'refiner');

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: formData
      });

      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("Refinement job queued! It will appear in your history shortly.");
      
      resetToNewJobState();
      queryClient.invalidateQueries({ queryKey: ['recentRefinementJobs'] });

    } catch (err: any) {
      showError(`Error: ${err.message}`);
      console.error("[Refine] Error:", err);
      dismissToast(toastId);
    } finally {
      setIsQueueing(false);
    }
  };

  const handleJobSelect = (job: ComfyJob) => {
    setSelectedJob(job);
    setSourceImageFile(null);
    setPrompt(job.metadata?.prompt || "");
    setOriginalDimensions(null);
  };

  const renderJobResult = (job: ComfyJob) => {
    switch (job.status) {
      case 'queued':
      case 'processing':
        return <div className="flex items-center justify-center h-full text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> In progress...</div>;
      case 'complete':
        return job.final_result?.publicUrl ? (
          <button onClick={() => showImage({ images: [{ url: job.final_result!.publicUrl }], currentIndex: 0 })} className="block w-full h-full">
            <img src={job.final_result.publicUrl} alt="Refined by ComfyUI" className="rounded-lg aspect-square object-contain w-full hover:opacity-80 transition-opacity" />
          </button>
        ) : <p>Job completed, but no image URL found.</p>;
      case 'failed':
        return <p className="text-destructive text-sm p-2">Job failed: {job.error_message}</p>;
      default:
        return null;
    }
  };

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
          {/* Left Column: Workbench */}
          <div className="lg:col-span-2">
            <Card className="min-h-[60vh]">
              <CardHeader><CardTitle>Workbench</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                      <h3 className="font-semibold mb-2 text-center">{t.originalImage}</h3>
                      <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                        {sourceImageUrl ? (
                            <button onClick={() => showImage({ images: [{ url: sourceImageUrl }], currentIndex: 0 })} className="block w-full h-full">
                                <img src={sourceImageUrl} alt="Original" className="rounded-lg aspect-square object-contain w-full hover:opacity-80 transition-opacity" />
                            </button>
                        ) : (
                            <div className="text-center text-muted-foreground p-4">
                                <UploadCloud className="h-12 w-12 mb-4 mx-auto" />
                                <p>Upload an image or select a recent job.</p>
                            </div>
                        )}
                      </div>
                  </div>
                  <div>
                      <h3 className="font-semibold mb-2 text-center">{t.refinedImage}</h3>
                      <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                          {selectedJob ? renderJobResult(selectedJob) : <p className="text-muted-foreground text-center p-4">Result will appear here.</p>}
                      </div>
                  </div>
              </CardContent>
            </Card>
            {selectedJob?.status === 'complete' && selectedJob?.final_result?.publicUrl && (
              <Button onClick={() => setIsCompareModalOpen(true)} className="mt-4 w-full">
                <GitCompareArrows className="mr-2 h-4 w-4" />
                {t.compareResults}
              </Button>
            )}
          </div>

          {/* Right Column: Controls */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>{selectedJob ? "Loaded Job" : "Start New Job"}</CardTitle>
                  {selectedJob && (
                    <Button variant="outline" size="sm" onClick={resetToNewJobState}>
                      <X className="h-4 w-4 mr-2" />
                      New Job
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent {...dropzoneProps} className={cn("p-4 border-2 border-dashed rounded-lg transition-colors", isDraggingOver && "border-primary bg-primary/10")}>
                <Input id="source-image-upload" type="file" accept="image/*" onChange={(e) => handleFileChange(e.target.files)} className="hidden" />
                <Label htmlFor="source-image-upload" className="cursor-pointer flex flex-col items-center justify-center text-center text-muted-foreground">
                  <UploadCloud className="h-12 w-12 mb-4" />
                  <p>Drag & drop or click to upload a new image and start a new job.</p>
                </Label>
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
                  <Switch id="auto-prompt-switch" checked={isAutoPromptEnabled} onCheckedChange={setIsAutoPromptEnabled} disabled={!!selectedJob} />
                </div>
                <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t.refinementPromptPlaceholder} rows={4} disabled={isLoadingAutoPrompt || !!selectedJob} />
                {isLoadingAutoPrompt && <p className="text-sm text-muted-foreground mt-2 flex items-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing...</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t.upscaleSettings}</CardTitle></CardHeader>
              <CardContent>
                  <div className="space-y-2">
                      <Label>{t.upscaleFactor}: {upscaleFactor.toFixed(1)}x</Label>
                      <Slider value={[upscaleFactor]} onValueChange={(value) => setUpscaleFactor(value[0])} min={1} max={4} step={0.1} disabled={!!selectedJob} />
                      {originalDimensions && (
                          <p className="text-sm text-muted-foreground text-center">
                              {originalDimensions.width}x{originalDimensions.height} → 
                              {' '}{Math.round(originalDimensions.width * upscaleFactor)}x{Math.round(originalDimensions.height * upscaleFactor)}
                          </p>
                      )}
                  </div>
              </CardContent>
            </Card>
            <Button onClick={handleRefine} disabled={isQueueing || !sourceImageFile} className="w-full">
              {isQueueing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Queue Refinement Job
            </Button>
          </div>
        </div>

        {/* History at the bottom */}
        <Card className="mt-8">
          <CardHeader><CardTitle>Recent Refinements</CardTitle></CardHeader>
          <CardContent>
            {isLoadingRecentJobs ? (
              <div className="flex gap-4"><Skeleton className="h-24 w-24" /><Skeleton className="h-24 w-24" /><Skeleton className="h-24 w-24" /></div>
            ) : recentJobs && recentJobs.length > 0 ? (
              <div className="flex gap-4 overflow-x-auto pb-2">
                {recentJobs.map(job => (
                  <button key={job.id} onClick={() => handleJobSelect(job)} className={cn("border-2 rounded-lg p-1 flex-shrink-0", selectedJob?.id === job.id ? "border-primary" : "border-transparent")}>
                    <img src={job.metadata?.source_image_url} alt="Job source" className="w-24 h-24 object-cover rounded-md" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">Your recent refinement jobs will appear here.</p>
            )}
          </CardContent>
        </Card>
      </div>
      {selectedJob && selectedJob.metadata?.source_image_url && selectedJob.final_result?.publicUrl && (
        <ImageCompareModal
          isOpen={isCompareModalOpen}
          onClose={() => setIsCompareModalOpen(false)}
          beforeUrl={selectedJob.metadata.source_image_url}
          afterUrl={selectedJob.final_result.publicUrl}
        />
      )}
    </>
  );
};

export default Refine;