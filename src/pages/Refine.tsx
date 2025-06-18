import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Image as ImageIcon, Sparkles, Wand2, UploadCloud, X, CheckCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface Job {
  id: string;
  status: string;
  final_result: any;
  original_prompt: string;
  context: any;
}

const Refine = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { uploadedFiles, setUploadedFiles, handleFileUpload, removeFile } = useFileUpload();

  const [prompt, setPrompt] = useState("");
  const [upscaleFactor, setUpscaleFactor] = useState(1.5);
  const [useAutoPrompt, setUseAutoPrompt] = useState(true);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery<Job[]>({
    queryKey: ['recentRefinerJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-jobs')
        .select('id, status, final_result, original_prompt, context')
        .eq('context->>source', 'refiner')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const sourceImageUrl = useMemo(() => {
    if (activeJob) return activeJob.context?.source_image_url;
    if (uploadedFiles.length > 0) return uploadedFiles[0].previewUrl;
    return null;
  }, [activeJob, uploadedFiles]);

  const resultImageUrl = useMemo(() => {
    return activeJob?.final_result?.images?.[0]?.publicUrl;
  }, [activeJob]);

  const handleGeneratePrompt = async () => {
    if (uploadedFiles.length === 0) return showError("Please upload an image first.");
    setIsGeneratingPrompt(true);
    const toastId = showLoading("Generating prompt from image...");
    try {
      const file = uploadedFiles[0].file;
      const reader = new FileReader();
      reader.readAsDataURL(file);
      const base64String = await new Promise<string>((resolve, reject) => {
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
      });
      const base64Data = base64String.split(',')[1];

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-auto-describe-image', {
        body: { base64_image_data: base64Data, mime_type: file.type }
      });
      if (error) throw error;
      setPrompt(data.auto_prompt);
      dismissToast(toastId);
      showSuccess("Prompt generated!");
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to generate prompt: ${err.message}`);
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const handleSubmit = async () => {
    if (uploadedFiles.length === 0) return showError("Please upload an image to refine.");
    if (!prompt.trim()) return showError("Please provide a refinement prompt.");
    
    setIsSubmitting(true);
    const toastId = showLoading("Uploading image and submitting job...");

    try {
      const { path } = await uploadedFiles[0].upload(supabase, 'mira-agent-user-uploads');
      const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(path);

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          prompt_text: prompt,
          image_url: publicUrl,
          invoker_user_id: session?.user?.id,
          upscale_factor: upscaleFactor,
          original_prompt_for_gallery: prompt,
          source: 'refiner',
          context: { source_image_url: publicUrl }
        }
      });

      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("Refinement job started! You can track its progress in the sidebar.");
      setActiveJob(data.job);
      queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
      queryClient.invalidateQueries({ queryKey: ['recentRefinerJobs'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Job submission failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startNew = () => {
    setActiveJob(null);
    setUploadedFiles([]);
    setPrompt("");
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
                  <div className="relative">
                    <img src={sourceImageUrl} alt="Source for refinement" className="rounded-md w-full" />
                    <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-6 w-6 rounded-full" onClick={() => { setUploadedFiles([]); setActiveJob(null); }}>
                      <X className="h-4 w-4" />
                    </Button>
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
                  <Switch id="auto-prompt" checked={useAutoPrompt} onCheckedChange={setUseAutoPrompt} />
                  <Label htmlFor="auto-prompt">{t('autoPrompt')}</Label>
                </div>
                {useAutoPrompt ? (
                  <Button className="w-full" onClick={handleGeneratePrompt} disabled={isGeneratingPrompt || uploadedFiles.length === 0}>
                    {isGeneratingPrompt ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {t('generateAndRefine')}
                  </Button>
                ) : (
                  <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('refinementPromptPlaceholder')} />
                )}
                {useAutoPrompt && prompt && <p className="text-sm p-2 bg-muted rounded-md">{prompt}</p>}
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
                  {activeJob && <Button variant="outline" onClick={startNew}>{t('startNewJob')}</Button>}
                </div>
                <p className="text-sm text-muted-foreground">{t('refineWorkbenchTooltip')}</p>
              </CardHeader>
              <CardContent className="min-h-[400px]">
                {activeJob ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h3 className="font-semibold mb-2">{t('originalImage')}</h3>
                        <img src={activeJob.context.source_image_url} alt="Original" className="rounded-md" />
                      </div>
                      <div>
                        <h3 className="font-semibold mb-2">{t('refinedImage')}</h3>
                        {resultImageUrl ? (
                          <img src={resultImageUrl} alt="Refined" className="rounded-md" />
                        ) : (
                          <div className="aspect-square bg-muted rounded-md flex flex-col items-center justify-center text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <p className="mt-2 text-sm">{t('inProgress')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {resultImageUrl && (
                      <Button className="w-full" onClick={() => setIsCompareModalOpen(true)}>{t('compareResults')}</Button>
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
                  <div className="space-y-2">
                    {recentJobs.map(job => (
                      <div key={job.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                        <div className="flex items-center gap-2">
                          {job.status === 'complete' ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Loader2 className="h-4 w-4 animate-spin" />}
                          <p className="text-sm truncate pr-4">{job.original_prompt}</p>
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setActiveJob(job)}>Load</Button>
                      </div>
                    ))}
                  </div>
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