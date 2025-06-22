import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Wand2, Brush, Palette, UploadCloud, Sparkles, Loader2, Image as ImageIcon, X, PlusCircle, AlertTriangle, Eye, Settings, History, HelpCircle, Shirt } from "lucide-react";
import { MaskCanvas } from "@/components/Editor/MaskCanvas";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { MaskControls } from "@/components/Editor/MaskControls";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Skeleton } from "../ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { DebugStepsModal } from "./DebugStepsModal";
import { Switch } from "../ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ProModeSettings } from "./ProModeSettings";
import { ScrollArea } from "../ui/scroll-area";
import { useLanguage } from "@/context/LanguageContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import ReactMarkdown from "react-markdown";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { optimizeImage } from "@/lib/utils";

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  source_person_image_url: string;
  source_garment_image_url: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'inpaint';
  metadata?: {
    debug_assets?: any;
    prompt_used?: string;
  }
}

const SecureImageDisplay = ({ imageUrl, alt, onClick, className }: { imageUrl: string | null, alt: string, onClick?: (e: React.MouseEvent<HTMLImageElement>) => void, className?: string }) => {
    const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
    const hasClickHandler = !!onClick;
  
    if (!imageUrl) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)}><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
    if (isLoading) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)}><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (error) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)}><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
    
    return <img src={displayUrl} alt={alt} className={cn("max-w-full max-h-full object-contain rounded-md", hasClickHandler && "cursor-pointer", className)} onClick={onClick} />;
};

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear, icon }: { onFileSelect: (file: File) => void, title: string, imageUrl: string | null, onClear: () => void, icon: React.ReactNode }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files[0]) });
  
    if (imageUrl) {
      return (
        <div className="relative h-32">
          <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}><X className="h-4 w-4" /></Button>
        </div>
      );
    }
  
    return (
      <div {...dropzoneProps} className={cn("flex flex-col h-32 justify-center items-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        <div className="text-center pointer-events-none">{icon}<p className="mt-2 text-sm font-semibold">{title}</p></div>
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files[0])} />
      </div>
    );
};

interface VirtualTryOnProProps {
  recentJobs: BitStudioJob[] | undefined;
  isLoadingRecentJobs: boolean;
  selectedJob: BitStudioJob | undefined;
  handleSelectJob: (job: BitStudioJob) => void;
  resetForm: () => void;
  transferredImageUrl?: string | null;
}

export const VirtualTryOnPro = ({ recentJobs, isLoadingRecentJobs, selectedJob, handleSelectJob, resetForm, transferredImageUrl }: VirtualTryOnProProps) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const { showImage } = useImagePreview();
  const queryClient = useQueryClient();
  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null);
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null);
  const [maskImage, setMaskImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [brushSize, setBrushSize] = useState(30);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isDebugModalOpen, setIsDebugModalOpen] = useState(false);
  const [isAutoPromptEnabled, setIsAutoPromptEnabled] = useState(true);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  const [numAttempts, setNumAttempts] = useState(1);
  const [denoise, setDenoise] = useState(0.99);
  const [isHighQuality, setIsHighQuality] = useState(false);
  const [maskExpansion, setMaskExpansion] = useState(3);

  const sourceImageUrl = useMemo(() => sourceImageFile ? URL.createObjectURL(sourceImageFile) : null, [sourceImageFile]);
  const referenceImageUrl = useMemo(() => referenceImageFile ? URL.createObjectURL(referenceImageFile) : null, [referenceImageFile]);

  useEffect(() => {
    if (transferredImageUrl) {
      const fetchImageAsFile = async (imageUrl: string) => {
        try {
          const url = new URL(imageUrl);
          const pathSegments = url.pathname.split('/');
          const objectIndex = pathSegments.indexOf('object');
          if (objectIndex === -1 || objectIndex + 2 > pathSegments.length) {
            throw new Error("Invalid Supabase URL format.");
          }
          const bucketName = pathSegments[objectIndex + 2];
          const pathStartIndex = url.pathname.indexOf(bucketName) + bucketName.length + 1;
          const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex));

          const { data: blob, error } = await supabase.storage
            .from(bucketName)
            .download(storagePath);

          if (error) throw error;
          if (!blob) throw new Error("Downloaded blob is null.");

          const filename = imageUrl.split('/').pop() || 'image.png';
          const file = new File([blob], filename, { type: blob.type });
          setSourceImageFile(file);
        } catch (e) {
          console.error("Failed to fetch transferred image for VTO Pro:", e);
          showError("Could not load the transferred image.");
        }
      };
      fetchImageAsFile(transferredImageUrl);
    }
  }, [transferredImageUrl, supabase]);

  useEffect(() => {
    return () => {
      if (sourceImageUrl) URL.revokeObjectURL(sourceImageUrl);
      if (referenceImageUrl) URL.revokeObjectURL(referenceImageUrl);
    };
  }, [sourceImageUrl, referenceImageUrl]);

  useEffect(() => {
    if (selectedJob) {
      setSourceImageFile(null);
      setReferenceImageFile(null);
      setMaskImage(null);
      setPrompt(selectedJob.metadata?.prompt_used || "");
      setResetTrigger(c => c + 1);
    }
  }, [selectedJob]);

  const proJobs = useMemo(() => recentJobs?.filter(job => job.mode === 'inpaint') || [], [recentJobs]);

  const handleFileSelect = (file: File | null) => {
    if (file && file.type.startsWith("image/")) {
      resetForm();
      setSourceImageFile(file);
      setReferenceImageFile(null);
      setMaskImage(null);
      setResetTrigger(c => c + 1);
    }
  };

  const handleResetMask = () => {
    setResetTrigger(c => c + 1);
  };

  const handleClearSourceImage = () => {
    setSourceImageFile(null);
    resetForm();
  };

  const handleGenerate = async () => {
    if (!sourceImageFile || !maskImage) {
      showError("Please provide a source image and draw a mask.");
      return;
    }
    if (!isAutoPromptEnabled && !prompt.trim()) {
      showError("Please provide a prompt or enable auto-prompt.");
      return;
    }
    setIsLoading(true);
    const toastId = showLoading(t('sendingJob'));

    try {
      const optimizedSource = await optimizeImage(sourceImageFile, { forceOriginalDimensions: true });

      const payload: any = {
        mode: 'inpaint',
        full_source_image_base64: await fileToBase64(optimizedSource),
        mask_image_base64: maskImage.split(',')[1],
        prompt: isAutoPromptEnabled ? "" : prompt,
        auto_prompt_enabled: isAutoPromptEnabled,
        user_id: session?.user.id,
        num_attempts: numAttempts,
        denoise: denoise,
        resolution: isHighQuality ? 'high' : 'standard',
        mask_expansion_percent: maskExpansion,
      };

      if (referenceImageFile) {
        const optimizedReference = await optimizeImage(referenceImageFile);
        payload.reference_image_base64 = await fileToBase64(optimizedReference);
      }

      const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
        body: payload
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess(`${numAttempts} inpainting job(s) started! You can track progress in the sidebar.`);
      queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
      queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session?.user?.id] });
      resetForm();

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Processing failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => handleFileSelect(e.target.files?.[0]),
  });

  const renderJobResult = (job: BitStudioJob) => {
    if (job.status === 'failed') return <p className="text-destructive text-sm p-2">{t('jobFailed', { errorMessage: job.error_message })}</p>;
    if (job.status === 'complete' && job.final_image_url) {
      return (
        <div className="relative group w-full h-full">
          <SecureImageDisplay imageUrl={job.final_image_url} alt="Final Result" onClick={() => showImage({ images: [{ url: job.final_image_url! }], currentIndex: 0 })} />
          {job.metadata?.debug_assets && (
            <Button 
              variant="secondary" 
              className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                setIsDebugModalOpen(true);
              }}
            >
              <Eye className="mr-2 h-4 w-4" />
              Show Steps
            </Button>
          )}
        </div>
      );
    }
    return (
      <div className="text-center text-muted-foreground">
        <Loader2 className="h-12 w-12 mx-auto animate-spin" />
        <p className="mt-4">{t('jobStatus', { status: job.status })}</p>
      </div>
    );
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 flex flex-col gap-4">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>{selectedJob ? t('selectedJob') : t('setup')}</CardTitle>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => setIsGuideOpen(true)}>
                            <HelpCircle className="h-5 w-5" />
                        </Button>
                        {(selectedJob || sourceImageFile) && <Button variant="outline" size="sm" onClick={handleClearSourceImage}><PlusCircle className="h-4 w-4 mr-2" />{t('new')}</Button>}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedJob ? (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">{t('viewingJob')}</p>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label>{t('sourceImage')}</Label>
                          <div className="mt-1 aspect-square w-full bg-muted rounded-md overflow-hidden">
                            <SecureImageDisplay imageUrl={selectedJob.source_person_image_url} alt="Source Person" />
                          </div>
                        </div>
                        <div>
                          <Label>{t('garmentReference')}</Label>
                          <div className="mt-1 aspect-square w-full bg-muted rounded-md overflow-hidden">
                            <SecureImageDisplay imageUrl={selectedJob.source_garment_image_url} alt="Source Garment" />
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label>{t('prompt')}</Label>
                        <p className="text-sm p-2 bg-muted rounded-md mt-1">{selectedJob.metadata?.prompt_used || "N/A"}</p>
                      </div>
                    </div>
                  ) : (
                    <Accordion type="multiple" defaultValue={['item-1']} className="w-full">
                      <AccordionItem value="item-1">
                        <AccordionTrigger>{t('inputs')}</AccordionTrigger>
                        <AccordionContent className="pt-4">
                          <div className="grid grid-cols-2 gap-4">
                            <ImageUploader onFileSelect={handleFileSelect} title={t('sourceImage')} imageUrl={sourceImageUrl} onClear={handleClearSourceImage} icon={<ImageIcon className="h-8 w-8 text-muted-foreground" />} />
                            <ImageUploader onFileSelect={setReferenceImageFile} title={t('garmentReference')} imageUrl={referenceImageUrl} onClear={() => setReferenceImageFile(null)} icon={<Shirt className="h-8 w-8 text-muted-foreground" />} />
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="item-2">
                        <AccordionTrigger>{t('promptSectionTitle')}</AccordionTrigger>
                        <AccordionContent className="pt-4 space-y-2">
                          <div className="flex items-center space-x-2">
                            <Switch id="auto-prompt-pro" checked={isAutoPromptEnabled} onCheckedChange={setIsAutoPromptEnabled} />
                            <Label htmlFor="auto-prompt-pro">{t('autoGenerate')}</Label>
                          </div>
                          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('promptPlaceholderVTO')} rows={4} disabled={isAutoPromptEnabled} />
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="item-3">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AccordionTrigger className="text-primary animate-pulse">{t('proSettings')}</AccordionTrigger>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{t('proSettingsTooltip')}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <AccordionContent className="pt-4">
                          <ProModeSettings
                            numAttempts={numAttempts} setNumAttempts={setNumAttempts}
                            denoise={denoise} setDenoise={setDenoise}
                            isHighQuality={isHighQuality} setIsHighQuality={setIsHighQuality}
                            maskExpansion={maskExpansion} setMaskExpansion={setMaskExpansion}
                            disabled={isLoading}
                          />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </CardContent>
              </Card>
              <Button size="lg" className="w-full" onClick={handleGenerate} disabled={isLoading || !!selectedJob}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {t('generate')}
              </Button>
            </div>
          </div>

          <div className="lg:col-span-2 bg-muted rounded-lg flex items-center justify-center relative min-h-[60vh] lg:min-h-0">
            {sourceImageUrl && !selectedJob ? (
              <div className="w-full h-full max-h-[80vh] aspect-square relative">
                <MaskCanvas 
                  imageUrl={sourceImageUrl} 
                  onMaskChange={setMaskImage}
                  brushSize={brushSize}
                  resetTrigger={resetTrigger}
                />
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
                  <MaskControls 
                    brushSize={brushSize} 
                    onBrushSizeChange={setBrushSize} 
                    onReset={handleResetMask} 
                  />
                </div>
              </div>
            ) : selectedJob ? (
              renderJobResult(selectedJob)
            ) : (
              <div {...dropzoneProps} className={cn("w-full h-full flex flex-col items-center justify-center cursor-pointer border-2 border-dashed rounded-lg", isDraggingOver && "border-primary")}>
                <UploadCloud className="h-12 w-12 text-muted-foreground" />
                <p className="mt-4 font-semibold">{t('uploadToBegin')}</p>
                <p className="text-sm text-muted-foreground">{t('orSelectRecent')}</p>
              </div>
            )}
          </div>
        </div>
        
        <Card className="mt-4">
          <CardHeader><CardTitle><div className="flex items-center gap-2"><History className="h-4 w-4" />{t('recentProJobs')}</div></CardTitle></CardHeader>
          <CardContent>
            {isLoadingRecentJobs ? <Skeleton className="h-24 w-full" /> : proJobs.length > 0 ? (
              <ScrollArea className="h-32">
                <div className="flex gap-4 pb-2">
                  {proJobs.map(job => {
                    const urlToPreview = job.final_image_url || job.source_person_image_url;
                    return (
                      <button key={job.id} onClick={() => handleSelectJob(job)} className={cn("border-2 rounded-lg p-0.5 flex-shrink-0 w-24 h-24", selectedJob?.id === job.id ? "border-primary" : "border-transparent")}>
                        <SecureImageDisplay imageUrl={urlToPreview} alt="Recent job" className="w-full h-full object-cover" />
                      </button>
                    )
                  })}
                </div>
              </ScrollArea>
            ) : <p className="text-muted-foreground text-sm">{t('noRecentProJobs')}</p>}
          </CardContent>
        </Card>
      </div>
      
      <DebugStepsModal 
        isOpen={isDebugModalOpen}
        onClose={() => setIsDebugModalOpen(false)}
        assets={selectedJob?.metadata?.debug_assets || null}
      />

      <Dialog open={isGuideOpen} onOpenChange={setIsGuideOpen}>
        <DialogContent className="max-w-2xl">
            <DialogHeader>
                <DialogTitle>{t('inpaintingGuideTitle')}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] pr-4">
                <div className="space-y-4 markdown-content">
                    <ReactMarkdown>{t('inpaintingGuideContent')}</ReactMarkdown>
                </div>
            </ScrollArea>
            <DialogFooter>
                <Button onClick={() => setIsGuideOpen(false)}>{t('done')}</Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};