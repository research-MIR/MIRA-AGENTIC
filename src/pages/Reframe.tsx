import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RealtimeChannel } from "@supabase/supabase-js";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";

interface ReframeJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: {
    images?: { publicUrl: string }[];
  };
  context?: {
    base_image_url?: string;
  };
  error_message?: string;
}

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
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

const Reframe = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const [baseFile, setBaseFile] = useState<File | null>(null);
  const [maskFile, setMaskFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [dilation, setDilation] = useState(0.03);
  const [steps, setSteps] = useState(35);
  const [count, setCount] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const basePreviewUrl = useMemo(() => baseFile ? URL.createObjectURL(baseFile) : null, [baseFile]);
  const maskPreviewUrl = useMemo(() => maskFile ? URL.createObjectURL(maskFile) : null, [maskFile]);

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery<ReframeJob[]>({
    queryKey: ['recentReframeJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-jobs')
        .select('id, status, final_result, context, error_message')
        .eq('context->>source', 'reframe')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => recentJobs?.find(j => j.id === selectedJobId), [recentJobs, selectedJobId]);

  const startNew = () => {
    setSelectedJobId(null);
    setBaseFile(null);
    setMaskFile(null);
    setPrompt("");
  };

  const handleSubmit = async () => {
    if (!baseFile || !maskFile) return showError("Please upload both a base and a mask image.");
    
    setIsSubmitting(true);
    const toastId = showLoading("Uploading images and queuing job...");

    try {
      const [base_image_base64, mask_image_base64] = await Promise.all([
        fileToBase64(baseFile),
        fileToBase64(maskFile)
      ]);

      const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-reframe', {
        body: {
          user_id: session?.user?.id,
          base_image_base64,
          mask_image_base64,
          prompt,
          dilation,
          steps,
          count
        }
      });

      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("Reframe job started! You can track its progress in the sidebar.");
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
      .on<ReframeJob>('postgres_changes', { event: '*', schema: 'public', table: 'mira-agent-jobs', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          if (payload.new.context?.source === 'reframe') {
            queryClient.invalidateQueries({ queryKey: ['recentReframeJobs', session.user.id] });
          }
        }
      ).subscribe();
    channelRef.current = channel;

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [session?.user?.id, supabase, queryClient]);

  const sourceImageUrl = selectedJob?.context?.base_image_url;
  const resultImageUrl = selectedJob?.status === 'complete' ? selectedJob.final_result?.images?.[0]?.publicUrl : null;

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
              <CardHeader><CardTitle>1. Setup</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <ImageUploader onFileSelect={setBaseFile} title={t('baseImage')} imageUrl={basePreviewUrl} onClear={() => setBaseFile(null)} />
                  <ImageUploader onFileSelect={setMaskFile} title={t('maskImage')} imageUrl={maskPreviewUrl} onClear={() => setMaskFile(null)} />
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
                  <Label>{t('maskDilation')}: {dilation.toFixed(3)}</Label>
                  <Slider value={[dilation]} onValueChange={(v) => setDilation(v[0])} min={0} max={0.1} step={0.005} />
                </div>
                <div>
                  <Label>{t('editSteps')}: {steps}</Label>
                  <Slider value={[steps]} onValueChange={(v) => setSteps(v[0])} min={10} max={75} step={1} />
                </div>
                <div>
                  <Label>{t('imageCount')}</Label>
                  <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
            <Button size="lg" className="w-full" onClick={handleSubmit} disabled={isSubmitting || !baseFile || !maskFile}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {t('generate')}
            </Button>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>{t('result')}</CardTitle>
                  {selectedJob && <Button variant="outline" onClick={startNew}>{t('newJob')}</Button>}
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
                  <ScrollArea className="h-32">
                    <div className="flex gap-4 pb-2">
                      {recentJobs.map(job => (
                        <RecentJobThumbnail
                          key={job.id}
                          job={{...job, metadata: { source_image_url: job.context?.base_image_url }}}
                          onClick={() => setSelectedJobId(job.id)}
                          isSelected={selectedJobId === job.id}
                        />
                      ))}
                    </div>
                  </ScrollArea>
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