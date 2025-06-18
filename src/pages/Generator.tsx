import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Image as ImageIcon, Sparkles, Wand2, Info } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { ModelSelector } from "@/components/ModelSelector";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { FileDropzone } from "@/components/FileDropzone";
import { useFileUpload } from "@/hooks/useFileUpload";
import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Job {
  id: string;
  status: string;
  final_result: any;
  original_prompt: string;
}

const Generator = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { showImage } = useImagePreview();
  const { uploadedFiles, setUploadedFiles, handleFileUpload, removeFile, isDragging, setIsDragging } = useFileUpload();

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [numImages, setNumImages] = useState(1);
  const [seed, setSeed] = useState("");
  const [useTwoStage, setUseTwoStage] = useState(true);
  const [useAIPromptHelper, setUseAIPromptHelper] = useState(false);

  const [isGenerating, setIsGenerating] = useState(false);
  const [jobResult, setJobResult] = useState<Job | null>(null);

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery<Job[]>({
    queryKey: ['recentGeneratorJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-jobs')
        .select('id, status, final_result, original_prompt')
        .eq('context->>source', 'direct_generator')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const handleGenerate = async () => {
    if (!prompt.trim() || !selectedModelId) {
      showError("Please provide a prompt and select a model.");
      return;
    }
    setIsGenerating(true);
    setJobResult(null);
    const toastId = showLoading("Submitting generation job...");

    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-direct-generator', {
        body: {
          prompt,
          negative_prompt: negativePrompt,
          model_id: selectedModelId,
          aspect_ratio: aspectRatio,
          num_images: numImages,
          seed: seed ? parseInt(seed) : undefined,
          use_two_stage: useTwoStage,
          use_ai_prompt_helper: useAIPromptHelper,
          reference_image_paths: uploadedFiles.map(f => f.path),
          invoker_user_id: session?.user?.id,
        }
      });

      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("Generation complete!");
      setJobResult(data.job);
      queryClient.invalidateQueries({ queryKey: ['recentGeneratorJobs'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const loadJob = (job: Job) => {
    setJobResult(job);
    setPrompt(job.original_prompt);
  };

  const startNewJob = () => {
    setJobResult(null);
    setPrompt("");
    setNegativePrompt("");
    setUploadedFiles([]);
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto relative" onDragEnter={() => setIsDragging(true)}>
      {isDragging && <FileDropzone onDrop={handleFileUpload} onDragStateChange={setIsDragging} />}
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('imageGenerator')}</h1>
        <p className="text-muted-foreground">{t('generatorDescription')}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>{t('generatorIntro')}</CardTitle></CardHeader>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('describeYourImage')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="prompt">{t('prompt')}</Label>
                <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('promptPlaceholderGenerator')} />
              </div>
              <div>
                <Label htmlFor="negative-prompt">{t('negativePrompt')}</Label>
                <Textarea id="negative-prompt" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder={t('negativePromptPlaceholder')} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('referenceImagesOptional')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch id="ai-prompt-helper" checked={useAIPromptHelper} onCheckedChange={setUseAIPromptHelper} disabled={uploadedFiles.length === 0} />
                <Label htmlFor="ai-prompt-helper">{t('aiPromptHelper')}</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent><p>{t('aiPromptHelperDescription')}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="p-4 border-2 border-dashed rounded-lg text-center">
                <ImageIcon className="mx-auto h-8 w-8 text-muted-foreground" />
                <Label htmlFor="file-upload-generator" className="mt-2 text-sm font-medium text-primary underline cursor-pointer">{t('uploadFiles')}</Label>
                <p className="text-xs text-muted-foreground">{t('dragAndDrop')}</p>
                <Input id="file-upload-generator" type="file" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files)} />
              </div>
              <div className="flex flex-wrap gap-2">
                {uploadedFiles.map((file, index) => (
                  <div key={index} className="relative">
                    <img src={file.previewUrl} alt={file.file.name} className="w-16 h-16 object-cover rounded-md" />
                    <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-5 w-5 rounded-full" onClick={() => removeFile(index)}>
                      <span className="text-xs">X</span>
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('configureSettings')}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch id="two-stage" checked={useTwoStage} onCheckedChange={setUseTwoStage} />
                <Label htmlFor="two-stage">{t('twoStageRefinement')}</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
                    <TooltipContent><p>{t('twoStageRefinementDescription')}</p></TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div>
                <Label>{t('model')}</Label>
                <ModelSelector selectedModelId={selectedModelId} onModelChange={setSelectedModelId} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="aspect-ratio">{t('aspectRatio')}</Label>
                  <Select value={aspectRatio} onValueChange={setAspectRatio}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1:1">1:1</SelectItem>
                      <SelectItem value="16:9">16:9</SelectItem>
                      <SelectItem value="9:16">9:16</SelectItem>
                      <SelectItem value="4:3">4:3</SelectItem>
                      <SelectItem value="3:4">3:4</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="num-images">{t('images')}</Label>
                  <Select value={String(numImages)} onValueChange={(v) => setNumImages(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">1</SelectItem>
                      <SelectItem value="2">2</SelectItem>
                      <SelectItem value="4">4</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label htmlFor="seed">{t('seed')}</Label>
                <Input id="seed" type="number" value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. 12345" />
              </div>
            </CardContent>
          </Card>
          <Button size="lg" className="w-full" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {t('generate')}
          </Button>
        </div>
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>{t('results')}</CardTitle>
                {jobResult && <Button variant="outline" onClick={startNewJob}>{t('newGeneration')}</Button>}
              </div>
            </CardHeader>
            <CardContent>
              {isGenerating ? (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <Loader2 className="h-12 w-12 animate-spin" />
                  <p className="mt-4">Generating your vision...</p>
                </div>
              ) : jobResult?.final_result?.images ? (
                <div className="space-y-4">
                  {jobResult.final_result.final_prompt_used && (
                    <div className="p-2 bg-muted rounded-md">
                      <p className="text-xs font-semibold">{t('finalPromptUsed')}:</p>
                      <p className="text-sm">{jobResult.final_result.final_prompt_used}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    {jobResult.final_result.images.map((image: any, index: number) => (
                      <div key={index} className="relative group">
                        <img src={image.publicUrl} alt={`Generated image ${index + 1}`} className="rounded-md w-full" />
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button onClick={() => showImage({ images: jobResult.final_result.images.map((img: any) => ({ url: img.publicUrl, jobId: jobResult.id })), currentIndex: index })}>View</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                  <ImageIcon className="h-12 w-12" />
                  <p className="mt-4">{t('resultsPlaceholder')}</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('recentGenerations')}</CardTitle></CardHeader>
            <CardContent>
              {isLoadingRecent ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
                <div className="space-y-2">
                  {recentJobs.map(job => (
                    <div key={job.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                      <p className="text-sm truncate pr-4">{job.original_prompt}</p>
                      <Button variant="ghost" size="sm" onClick={() => loadJob(job)}>Load</Button>
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
  );
};

export default Generator;