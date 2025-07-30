import { useState, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Image as ImageIcon, Wand2, UploadCloud, X, PlusCircle, AlertTriangle, Info } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useFileUpload } from "@/hooks/useFileUpload";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { RecentJobThumbnail } from "@/components/Jobs/RecentJobThumbnail";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useDropzone } from "@/hooks/useDropzone";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

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
  const singleInputRef = useRef<HTMLInputElement>(null);

  const [upscaleFactor, setUpscaleFactor] = useState(1.5);
  const [denoise, setDenoise] = useState(0.4);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  const startNew = () => {
    setSelectedJobId(null);
    setUploadedFiles([]);
  };

  const handleSubmit = async () => {
    if (!sourceImageUrl) return showError("Please upload or select an image to refine.");
    
    setIsSubmitting(true);
    const toastId = showLoading(t('sendingJob'));

    try {
        const payload: any = {
            invoker_user_id: session?.user?.id,
            upscale_factor: upscaleFactor,
            denoise: denoise,
            source: 'refiner',
        };

        if (sourceImageUrl.startsWith('blob:')) {
            const file = uploadedFiles[0].file;
            payload.base64_image_data = await fileToBase64(file);
            payload.mime_type = file.type;
        } else {
            payload.image_url = sourceImageUrl;
        }

        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', { body: payload });

        if (error) throw error;
        
        dismissToast(toastId);
        showSuccess("Upscale job started! You can track its progress in the sidebar.");
        queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
        queryClient.invalidateQueries({ queryKey: ['recentRefinerJobs'] });
        startNew();
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Job submission failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => handleFileUpload(e.target.files) });

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
                  <div {...dropzoneProps} onClick={() => singleInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary transition-colors", isDraggingOver && "border-primary bg-primary/10")}>
                    <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm font-medium">{t('uploadAFile')}</p>
                    <p className="text-xs text-muted-foreground">{t('dragAndDrop')}</p>
                    <Input ref={singleInputRef} id="refine-upload" type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e.target.files)} />
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('upscaleSettings')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>{t('upscaleFactor')}: {upscaleFactor}x</Label>
                  <Slider value={[upscaleFactor]} onValueChange={(v) => setUpscaleFactor(v[0])} min={1} max={4} step={0.1} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Label>Refinement Strength</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
                        <TooltipContent>
                          <p>Controls how much detail the AI adds. Low values are subtle, high values are more creative.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <Slider value={[denoise]} onValueChange={(v) => setDenoise(v[0])} min={0.1} max={1.0} step={0.05} />
                  <p className="text-xs text-center text-muted-foreground">{denoise.toFixed(2)}</p>
                </div>
              </CardContent>
            </Card>
            <Button size="lg" className="w-full" onClick={() => handleSubmit()} disabled={isSubmitting || !sourceImageUrl}>
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
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center relative">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">{t('originalImage')}</h3>
                        <SecureDisplayImage imageUrl={selectedJob.metadata?.source_image_url || null} />
                      </div>
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center relative">
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
                    <p className="mt-4">{t('uploadOrSelect')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('recentRefinements')}</CardTitle></CardHeader>
              <CardContent>
                {isLoadingRecent ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
                  <Carousel opts={{ align: "start" }} className="w-full">
                    <CarouselContent className="-ml-4">
                      {recentJobs.map(job => (
                        <CarouselItem key={job.id} className="pl-4 basis-auto">
                          <RecentJobThumbnail
                            job={job}
                            onClick={() => setSelectedJobId(job.id)}
                            isSelected={selectedJobId === job.id}
                          />
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    <CarouselPrevious />
                    <CarouselNext />
                  </Carousel>
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