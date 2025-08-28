import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Image as ImageIcon, Wand2, UploadCloud, X, PlusCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { Slider } from "@/components/ui/slider";
import { RecentJobThumbnail } from "@/components/Jobs/RecentJobThumbnail";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RealtimeChannel } from "@supabase/supabase-js";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

interface ReframeJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: {
    publicUrl: string;
  };
  source_image_url: string;
  error_message?: string;
}

const fileToJpegBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Failed to get canvas context'));
        ctx.drawImage(img, 0, 0);
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.9); // 90% quality
        resolve(jpegDataUrl.split(',')[1]);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear }: { onFileSelect: (file: File) => void, title: string, imageUrl: string | null, onClear: () => void }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files[0]) });
  
    if (imageUrl) {
      return (
        <div className="relative aspect-square">
          <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}><X className="h-4 w-4" /></Button>
        </div>
      );
    }
  
    return (
      <div {...dropzoneProps} className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        <div className="text-center pointer-events-none"><UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{title}</p></div>
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files[0])} />
      </div>
    );
};

const commonRatios = ["1:1", "9:16", "16:9", "4:3", "3:4", "21:9", "3:2", "2:3", "4:5", "5:4"];

const Reframe = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [aspectRatios, setAspectRatios] = useState<string[]>(["1:1"]);
  const [customRatio, setCustomRatio] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const basePreviewUrl = useMemo(() => baseFile ? URL.createObjectURL(baseFile) : null, [baseFile]);

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery<ReframeJob[]>({
    queryKey: ['recentReframeJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('fal_reframe_jobs')
        .select('id, status, final_result, source_image_url, error_message')
        .eq('user_id', session.user.id)
        .is('parent_vto_job_id', null) // Only show standalone jobs
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => recentJobs?.find(j => j.id === selectedJobId), [recentJobs, selectedJobId]);

  const startNew = () => {
    setSelectedJobId(null);
    setBaseFile(null);
    setPrompt("");
    setAspectRatios(["1:1"]);
  };

  const addAspectRatio = (ratio: string) => {
    if (ratio && /^\d+:\d+$/.test(ratio) && !aspectRatios.includes(ratio)) {
      setAspectRatios(prev => [...prev, ratio]);
    }
  };

  const removeAspectRatio = (ratioToRemove: string) => {
    setAspectRatios(prev => prev.filter(r => r !== ratioToRemove));
  };

  const handleAddCustomRatio = () => {
    addAspectRatio(customRatio);
    setCustomRatio("");
  };

  const handleSubmit = async () => {
    if (!baseFile) return showError("Please upload a base image.");
    if (aspectRatios.length === 0) return showError("Please select at least one aspect ratio.");
    
    setIsSubmitting(true);
    const toastId = showLoading(`Uploading image and queuing ${aspectRatios.length} job(s)...`);

    try {
      const filePath = `${session?.user.id}/reframe-sources/${Date.now()}-${baseFile.name}`;
      const { error: uploadError } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, baseFile);
      if (uploadError) throw uploadError;
      const { data: { publicUrl: base_image_url } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);

      const jobPromises = aspectRatios.map(ratio => {
          return supabase.functions.invoke('MIRA-AGENT-proxy-reframe-fal', {
              body: {
                  user_id: session?.user?.id,
                  base_image_url,
                  prompt,
                  aspect_ratio: ratio,
                  parent_vto_job_id: null, // This is a standalone job
              }
          });
      });

      const results = await Promise.allSettled(jobPromises);
      const failedCount = results.filter(r => r.status === 'rejected').length;

      dismissToast(toastId);
      if (failedCount > 0) {
          showError(`${failedCount} jobs failed to queue. Please check the console for details.`);
          results.forEach(r => {
              if (r.status === 'rejected') console.error("Reframe job failed:", r.reason);
          });
      }
      if (failedCount < aspectRatios.length) {
          showSuccess(`${aspectRatios.length - failedCount} reframe job(s) started successfully!`);
      }
      
      queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
      queryClient.invalidateQueries({ queryKey: ['recentReframeJobs'] });
      startNew();

    } catch (err: any) {
      dismissToast(toastId);
      showError(`Job submission failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!session?.user?.id) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase.channel(`reframe-jobs-tracker-${session.user.id}`)
      .on<ReframeJob>('postgres_changes', { event: '*', schema: 'public', table: 'fal_reframe_jobs', filter: `user_id=eq.${session.user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['recentReframeJobs', session.user.id] });
        }
      ).subscribe();
    channelRef.current = channel;

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [session?.user?.id, supabase, queryClient]);

  const sourceImageUrl = selectedJob?.source_image_url;
  const resultImageUrl = selectedJob?.status === 'complete' ? selectedJob.final_result?.publicUrl : null;

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">{t('reframe')}</h1>
          <p className="text-muted-foreground">{t('reframeDescription')}</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>1. Setup</CardTitle>
                  {selectedJobId && <Button variant="outline" onClick={startNew}>{t('newJob')}</Button>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="max-w-xs mx-auto">
                  <ImageUploader onFileSelect={(files) => files && setBaseFile(files[0])} title={t('baseImage')} imageUrl={basePreviewUrl} onClear={() => setBaseFile(null)} />
                </div>
                <div>
                  <Label htmlFor="prompt">{t('prompt')}</Label>
                  <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('promptPlaceholder')} rows={3} />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>2. Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>{t('aspectRatio')}</Label>
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {aspectRatios.map(r => (
                        <Badge key={r} variant="secondary" className="flex items-center gap-1">
                          {r}
                          <button onClick={() => removeAspectRatio(r)} className="rounded-full hover:bg-muted-foreground/20"><X className="h-3 w-3" /></button>
                        </Badge>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input value={customRatio} onChange={(e) => setCustomRatio(e.target.value)} placeholder={t('customRatio')} onKeyDown={(e) => e.key === 'Enter' && handleAddCustomRatio()} />
                      <Button onClick={handleAddCustomRatio}>{t('addRatio')}</Button>
                    </div>
                    <div className="flex flex-wrap gap-1 pt-1">
                      {commonRatios.filter(r => !aspectRatios.includes(r)).map(r => (
                        <Button key={r} size="xs" variant="outline" onClick={() => addAspectRatio(r)}>{r}</Button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Button size="lg" className="w-full" onClick={handleSubmit} disabled={isSubmitting || !baseFile || aspectRatios.length === 0}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {t('generateNImages', { count: aspectRatios.length })}
            </Button>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>{t('result')}</CardTitle>
                  {selectedJobId && <Button variant="outline" onClick={startNew}>{t('newJob')}</Button>}
                </div>
              </CardHeader>
              <CardContent className="min-h-[400px]">
                {selectedJob ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center relative">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">{t('originalImage')}</h3>
                        <SecureImageDisplay imageUrl={sourceImageUrl || null} alt="Original" />
                      </div>
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center relative">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">{t('generatedImage')}</h3>
                        {resultImageUrl ? (
                          <SecureImageDisplay imageUrl={resultImageUrl} alt="Result" />
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
                    <p className="mt-4">{t('uploadAnImageToStart')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('recentReframes')}</CardTitle></CardHeader>
              <CardContent>
                {isLoadingRecent ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
                  <Carousel opts={{ align: "start" }} className="w-full">
                    <CarouselContent className="-ml-4">
                      {recentJobs.map(job => (
                        <CarouselItem key={job.id} className="pl-4 basis-auto">
                          <RecentJobThumbnail
                            job={{...job, metadata: { source_image_url: job.source_image_url }}}
                            onClick={() => setSelectedJobId(job.id)}
                            isSelected={selectedJobId === job.id}
                          />
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    <CarouselPrevious className="left-2" />
                    <CarouselNext className="right-2" />
                  </Carousel>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('noRecentReframes')}</p>
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

export default Reframe;