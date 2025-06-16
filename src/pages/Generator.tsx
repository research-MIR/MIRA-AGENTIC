import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ModelSelector } from "@/components/ModelSelector";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Sparkles, Wand2, UploadCloud, X, GalleryHorizontal, PlusCircle } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/context/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GeneratorJobThumbnail } from "@/components/GeneratorJobThumbnail";
import { Skeleton } from "@/components/ui/skeleton";
import { RealtimeChannel } from "@supabase/supabase-js";

interface Job {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  context: {
    prompt: string;
    negative_prompt?: string;
    number_of_images?: number;
    seed?: number;
    model_id: string;
    size: string;
  };
  final_result?: {
    images?: { publicUrl: string }[];
  };
}

interface AspectRatioOption {
    label: string;
    size: string;
}

const aspectRatioOptions: Record<string, AspectRatioOption> = {
    "1024x1024": { label: "Square (1:1)", size: "1024x1024" },
    "768x1408": { label: "Portrait (9:16)", size: "768x1408" },
    "1408x768": { label: "Landscape (16:9)", size: "1408x768" },
    "1280x896": { label: "Landscape (4:3)", size: "1280x896" },
    "896x1280": { label: "Portrait (3:4)", size: "896x1280" },
};

const Generator = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [numImages, setNumImages] = useState(1);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1024x1024");
  const [isLoading, setIsLoading] = useState(false);
  const [finalPromptUsed, setFinalPromptUsed] = useState<string | null>(null);
  
  const [styleReferenceImageFile, setStyleReferenceImageFile] = useState<File | null>(null);
  const [styleReferenceImageUrl, setStyleReferenceImageUrl] = useState<string | null>(null);
  const [garmentReferenceImageFiles, setGarmentReferenceImageFiles] = useState<File[]>([]);
  const [garmentReferenceImageUrls, setGarmentReferenceImageUrls] = useState<string[]>([]);
  const [isHelperEnabled, setIsHelperEnabled] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const garmentInputRef = useRef<HTMLInputElement>(null);
  const styleInputRef = useRef<HTMLInputElement>(null);

  const { data: recentJobs, isLoading: isLoadingRecentJobs } = useQuery<Job[]>({
    queryKey: ['directGeneratorJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-jobs')
        .select('id, status, context, final_result')
        .eq('context->>source', 'direct_generator')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  useEffect(() => {
    if (!session?.user) return;

    const channel = supabase.channel('direct-generator-jobs-tracker')
      .on<Job>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-jobs', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          const job = payload.new as Job;
          if (job?.context?.source === 'direct_generator') {
            console.log('[GeneratorRealtime] Direct generator job updated, invalidating query.');
            queryClient.invalidateQueries({ queryKey: ['directGeneratorJobs', session.user.id] });
          }
        }
      )
      .subscribe();
    
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [supabase, session?.user?.id, queryClient]);

  const resetForm = useCallback(() => {
    setPrompt("");
    setNegativePrompt("");
    setNumImages(1);
    setSeed(undefined);
    setAspectRatio("1024x1024");
    setFinalPromptUsed(null);
    handleRemoveStyleReferenceImage();
    setGarmentReferenceImageFiles([]);
    setGarmentReferenceImageUrls(prev => {
      prev.forEach(url => URL.revokeObjectURL(url));
      return [];
    });
    setSelectedJobId(null);
  }, []);

  const handleJobSelect = (job: Job) => {
    resetForm();
    setPrompt(job.context.prompt);
    setNegativePrompt(job.context.negative_prompt || "");
    setNumImages(job.context.number_of_images || 1);
    setSeed(job.context.seed);
    setSelectedModelId(job.context.model_id);
    setAspectRatio(job.context.size || "1024x1024");
    setSelectedJobId(job.id);
    showSuccess("Loaded settings from previous job. Note: Reference images are not reloaded.");
  };

  const handleStyleReferenceImageChange = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      if (file.type.startsWith('video/') || file.type === 'image/avif') {
        showError("Unsupported file type. AVIF and video formats are not allowed.");
        return;
      }
      setStyleReferenceImageFile(file);
      setStyleReferenceImageUrl(URL.createObjectURL(file));
    }
  }, []);

  const handleRemoveStyleReferenceImage = () => {
    if (styleReferenceImageUrl) URL.revokeObjectURL(styleReferenceImageUrl);
    setStyleReferenceImageFile(null);
    setStyleReferenceImageUrl(null);
  };

  const handleGarmentImagesChange = useCallback((files: FileList | null) => {
    if (files) {
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];

      Array.from(files).forEach(file => {
        if (file.type.startsWith('video/') || file.type === 'image/avif') {
          invalidFiles.push(file.name);
        } else {
          validFiles.push(file);
        }
      });

      if (invalidFiles.length > 0) {
        showError(`Unsupported file type(s): ${invalidFiles.join(', ')}. AVIF and video formats are not allowed.`);
      }

      if (validFiles.length > 0) {
        setGarmentReferenceImageFiles(prev => [...prev, ...validFiles]);
        const newUrls = validFiles.map(file => URL.createObjectURL(file));
        setGarmentReferenceImageUrls(prev => [...prev, ...newUrls]);
      }
    }
  }, []);

  const handleRemoveGarmentImage = (indexToRemove: number) => {
    URL.revokeObjectURL(garmentReferenceImageUrls[indexToRemove]);
    setGarmentReferenceImageFiles(prev => prev.filter((_, index) => index !== indexToRemove));
    setGarmentReferenceImageUrls(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const { isDraggingOver: isStyleDragging, dropzoneProps: styleDropzoneProps } = useDropzone({ onDrop: handleStyleReferenceImageChange });
  const { isDraggingOver: isGarmentDragging, dropzoneProps: garmentDropzoneProps } = useDropzone({ onDrop: handleGarmentImagesChange });

  useEffect(() => {
    return () => {
      if (styleReferenceImageUrl) URL.revokeObjectURL(styleReferenceImageUrl);
      garmentReferenceImageUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [styleReferenceImageUrl, garmentReferenceImageUrls]);

  const uploadFileAndGetUrl = async (file: File | null, bucket: string): Promise<string | null> => {
    if (!file) return null;
    if (!session?.user) throw new Error("User session not found.");
    const filePath = `${session.user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file);
    if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return publicUrl;
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return showError("Please enter a prompt.");
    if (!session?.user) return showError("You must be logged in to generate images.");

    setIsLoading(true);
    setFinalPromptUsed(null);
    let toastId = showLoading("Warming up the engines...");
    let promptToUse = prompt;

    try {
      if (isHelperEnabled && (garmentReferenceImageFiles.length > 0 || styleReferenceImageFile)) {
        dismissToast(toastId);
        toastId = showLoading("AI Helper is analyzing your references...");
        
        const garmentUploadPromises = garmentReferenceImageFiles.map(file => uploadFileAndGetUrl(file, 'mira-agent-user-uploads'));
        const garment_image_urls = (await Promise.all(garmentUploadPromises)).filter(url => url !== null) as string[];
        const style_image_url = await uploadFileAndGetUrl(styleReferenceImageFile, 'mira-agent-user-uploads');

        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-direct-generator-prompt-helper', {
          body: { user_prompt: prompt, garment_image_urls, style_image_url }
        });

        if (error) throw error;
        promptToUse = data.final_prompt;
        setFinalPromptUsed(promptToUse);
      } else {
        setFinalPromptUsed(prompt);
      }

      dismissToast(toastId);
      toastId = showLoading(`Queueing generation job...`);
      if (!selectedModelId) throw new Error("Please select a model.");
      
      const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-direct-generator', { 
          body: { 
              prompt: prompt,
              final_prompt_used: promptToUse,
              negative_prompt: negativePrompt, 
              number_of_images: numImages, 
              seed, 
              model_id: selectedModelId, 
              invoker_user_id: session.user.id,
              size: aspectRatio
          } 
      });
      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("Job queued! Your images will appear in the gallery shortly.");
      queryClient.invalidateQueries({ queryKey: ["directGeneratorJobs"] });
      resetForm();

    } catch (err: any) {
      showError(err.message || "An unknown error occurred.");
      console.error("[Generator] Error:", err);
    } finally {
      setIsLoading(false);
      dismissToast(toastId);
    }
  };

  const renderGarmentUploader = () => (
    <div {...garmentDropzoneProps}>
      <Label>{t.garmentReference}</Label>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {garmentReferenceImageUrls.map((url, index) => (
          <div key={index} className="relative">
            <img src={url} alt={`Garment ${index + 1}`} className="w-full h-24 object-cover rounded-md" />
            <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => handleRemoveGarmentImage(index)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div 
        className={cn("mt-2 flex justify-center rounded-lg border border-dashed border-border px-6 py-4 transition-colors cursor-pointer", isGarmentDragging && "border-primary bg-primary/10")}
        onClick={() => garmentInputRef.current?.click()}
      >
        <div className="text-center pointer-events-none">
          <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-2 flex text-sm leading-6 text-muted-foreground">
            <span className="relative rounded-md bg-background font-semibold text-primary">
              {t.uploadFiles}
            </span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{t.dragAndDrop}</p>
        </div>
      </div>
      <Input 
        ref={garmentInputRef}
        id="garment-reference-image-upload" 
        type="file" 
        className="sr-only" 
        onChange={(e) => handleGarmentImagesChange(e.target.files)} 
        accept="image/*" 
        multiple 
      />
    </div>
  );

  const renderStyleUploader = () => (
    <div {...styleDropzoneProps}>
      <Label>{t.styleReference}</Label>
      {styleReferenceImageUrl ? (
        <div className="mt-2 relative">
          <img src={styleReferenceImageUrl} alt="Reference" className="w-full h-auto rounded-md object-contain max-h-60" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={handleRemoveStyleReferenceImage}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div 
          className={cn("mt-2 flex justify-center rounded-lg border border-dashed border-border px-6 py-10 transition-colors cursor-pointer", isStyleDragging && "border-primary bg-primary/10")}
          onClick={() => styleInputRef.current?.click()}
        >
          <div className="text-center pointer-events-none">
            <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
            <div className="mt-4 flex text-sm leading-6 text-muted-foreground">
              <span className="relative rounded-md bg-background font-semibold text-primary">
                {t.uploadAFile}
              </span>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{t.dragAndDrop}</p>
          </div>
        </div>
      )}
      <Input 
        ref={styleInputRef}
        id="style-reference-image-upload" 
        type="file" 
        className="sr-only" 
        onChange={(e) => handleStyleReferenceImageChange(e.target.files)} 
        accept="image/*" 
      />
    </div>
  );

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.imageGenerator}</h1>
          <p className="text-muted-foreground">{t.generatorIntro}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card id="generator-prompt-card">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>{selectedJobId ? t.loadedJob : t.newGeneration}</CardTitle>
                {selectedJobId && (
                  <Button variant="outline" size="sm" onClick={resetForm}>
                    <PlusCircle className="h-4 w-4 mr-2" />
                    {t.newJob}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="prompt">{t.prompt}</Label>
                  <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t.promptPlaceholderGenerator} rows={6} />
                </div>
                <div>
                  <Label htmlFor="negative-prompt">{t.negativePrompt}</Label>
                  <Textarea id="negative-prompt" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder={t.negativePromptPlaceholder} rows={3} />
                </div>
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>{t.referenceImagesOptional}</AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4 pt-4">
                        {renderGarmentUploader()}
                        {renderStyleUploader()}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <Card id="generator-settings-card">
            <CardHeader>
              <CardTitle>{t.configureSettings}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <Label>{t.aiPromptHelper}</Label>
                  <p className="text-[0.8rem] text-muted-foreground">
                    {t.aiPromptHelperDescription}
                  </p>
                </div>
                <Switch
                  checked={isHelperEnabled}
                  onCheckedChange={setIsHelperEnabled}
                />
              </div>
              <div>
                <Label>{t.model}</Label>
                <ModelSelector selectedModelId={selectedModelId} onModelChange={setSelectedModelId} />
              </div>
              <div>
                <Label>{t.aspectRatio}</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select aspect ratio..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(aspectRatioOptions).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="num-images">{t.images}</Label>
                  <Input id="num-images" type="number" value={numImages} onChange={(e) => setNumImages(Math.max(1, parseInt(e.target.value, 10)))} min="1" max="8" />
                </div>
                <div>
                  <Label htmlFor="seed">{t.seed}</Label>
                  <Input id="seed" type="number" placeholder="Random" value={seed || ''} onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value, 10) : undefined)} />
                </div>
              </div>
            </CardContent>
          </Card>
          <Button onClick={handleGenerate} disabled={isLoading} className="w-full">
            {isLoading ? <Wand2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {t.generate}
          </Button>
        </div>

        <div className="lg:col-span-1">
          <Card className="min-h-[60vh]">
            <CardHeader>
              <CardTitle>{t.results}</CardTitle>
            </CardHeader>
            <CardContent>
              {finalPromptUsed && (
                <div className="mb-4">
                  <Label>{t.finalPromptUsed}</Label>
                  <Textarea readOnly value={finalPromptUsed} className="mt-1 h-24 font-mono text-xs" />
                </div>
              )}
              <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-64">
                <Sparkles className="h-12 w-12 mb-4" />
                <p>{t.galleryPlaceholder}</p>
                <Button variant="outline" className="mt-4" onClick={() => navigate('/gallery')}>
                  <GalleryHorizontal className="mr-2 h-4 w-4" />
                  {t.goToGallery}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-8">
        <CardHeader><CardTitle>{t.recentGenerations}</CardTitle></CardHeader>
        <CardContent>
          {isLoadingRecentJobs ? (
            <div className="flex gap-4"><Skeleton className="h-24 w-24" /><Skeleton className="h-24 w-24" /><Skeleton className="h-24 w-24" /></div>
          ) : recentJobs && recentJobs.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {recentJobs.map(job => (
                <GeneratorJobThumbnail
                  key={job.id}
                  job={job}
                  onClick={() => handleJobSelect(job)}
                  isSelected={selectedJobId === job.id}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-24">
              <p>{t.noRecentJobs}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Generator;