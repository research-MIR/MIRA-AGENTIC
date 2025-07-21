import { useState, useMemo, useRef, useEffect } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Wand2, UploadCloud, X, FlaskConical, Image as ImageIcon, PlusCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RealtimeChannel } from "@supabase/supabase-js";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RecentJobThumbnail } from "@/components/Jobs/RecentJobThumbnail";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { useQuery, useQueryClient } from "@tanstack/react-query";

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear, multiple = false }: { onFileSelect: (files: FileList) => void, title: string, imageUrl?: string | null, onClear?: () => void, multiple?: boolean }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files) });
  
    if (imageUrl && onClear) {
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
        <Input ref={inputRef} type="file" multiple={multiple} className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files)} />
      </div>
    );
};

const aspectRatioOptions = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "3:2", "2:3"];

const ProductRecontext = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const { showImage } = useImagePreview();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const queryClient = useQueryClient();

  const [productFiles, setProductFiles] = useState<File[]>([]);
  const [sceneFile, setSceneFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const productPreviews = useMemo(() => productFiles.map(f => URL.createObjectURL(f)), [productFiles]);
  const scenePreview = useMemo(() => sceneFile ? URL.createObjectURL(sceneFile) : null, [sceneFile]);

  const { data: activeJob, isLoading: isLoadingActiveJob } = useQuery({
    queryKey: ['recontextJob', activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const { data, error } = await supabase.from('mira-agent-jobs').select('*').eq('id', activeJobId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!activeJobId,
  });

  useEffect(() => {
    if (!activeJobId || !session?.user?.id) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase.channel(`recontext-job-${activeJobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mira-agent-jobs', filter: `id=eq.${activeJobId}` },
        (payload) => {
          queryClient.setQueryData(['recontextJob', activeJobId], payload.new);
        }
      ).subscribe();
    channelRef.current = channel;

    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [activeJobId, session?.user?.id, supabase, queryClient]);

  const handleGenerate = async () => {
    if (productFiles.length === 0 || (!prompt && !sceneFile)) {
      showError("Please provide at least one product image and either a scene prompt or a scene reference image.");
      return;
    }
    setIsSubmitting(true);
    const toastId = showLoading("Preparing assets and starting job...");

    try {
      const product_images_base64 = await Promise.all(productFiles.map(fileToBase64));
      const scene_reference_image_base64 = sceneFile ? await fileToBase64(sceneFile) : null;

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-recontext', {
        body: { 
          user_id: session?.user?.id,
          product_images_base64, 
          user_scene_prompt: prompt, 
          scene_reference_image_base64,
          aspect_ratio: aspectRatio
        }
      });
      if (error) throw error;
      
      setActiveJobId(data.jobId);
      dismissToast(toastId);
      showSuccess("Job started successfully!");
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Generation failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startNew = () => {
    setActiveJobId(null);
    setProductFiles([]);
    setSceneFile(null);
    setPrompt("");
    setAspectRatio("1:1");
  };

  const resultImageUrl = activeJob?.status === 'complete' ? activeJob.final_result?.images?.[0]?.publicUrl : null;
  const sourceImageUrl = activeJob?.context?.base_image_url;

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">{t('productRecontext')}</h1>
          <p className="text-muted-foreground">{t('productRecontextDescription')}</p>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Setup</CardTitle>
                {activeJob && <Button variant="outline" onClick={startNew}>{t('newJob')}</Button>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('productImage')} (up to 3)</Label>
                  <ImageUploader onFileSelect={(files) => files && setProductFiles(Array.from(files).slice(0, 3))} title={t('uploadProduct')} multiple />
                  {productPreviews.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {productPreviews.map((url, index) => (
                        <div key={index} className="relative">
                          <img src={url} alt={`Product preview ${index + 1}`} className="w-16 h-16 object-cover rounded-md" />
                          <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-5 w-5 rounded-full" onClick={() => setProductFiles(files => files.filter((_, i) => i !== index))}><X className="h-3 w-3" /></Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="scene-prompt">{t('scenePrompt')}</Label>
                  <Textarea id="scene-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('scenePromptPlaceholder')} rows={3} />
                  <Label className="pt-2 block">{t('sceneReferenceImage')}</Label>
                  <ImageUploader onFileSelect={(files) => files && setSceneFile(files[0])} title={t('uploadSceneReference')} imageUrl={scenePreview} onClear={() => setSceneFile(null)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="aspect-ratio">{t('aspectRatio')}</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger id="aspect-ratio"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {aspectRatioOptions.map(ratio => <SelectItem key={ratio} value={ratio}>{ratio}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={handleGenerate} disabled={isSubmitting || isLoadingActiveJob || (activeJob && activeJob.status !== 'complete' && activeJob.status !== 'failed')}>
                {(isSubmitting || isLoadingActiveJob) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                {t('generate')}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t('result')}</CardTitle></CardHeader>
            <CardContent>
              {isLoadingActiveJob || (activeJob && activeJob.status === 'processing') ? (
                <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : resultImageUrl ? (
                <div className="space-y-4">
                  <div className="mt-2 aspect-square w-full bg-muted rounded-md flex items-center justify-center">
                    <button className="w-full h-full" onClick={() => showImage({ images: [{ url: resultImageUrl }], currentIndex: 0 })}>
                      <img src={resultImageUrl} className="max-w-full max-h-full object-contain" />
                    </button>
                  </div>
                  <Button className="w-full" onClick={() => setIsCompareModalOpen(true)}>{t('compareResults')}</Button>
                </div>
              ) : (
                <div className="flex items-center justify-center h-64">
                  <p className="text-sm text-muted-foreground">{t('resultPlaceholder')}</p>
                </div>
              )}
            </CardContent>
          </Card>
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

export default ProductRecontext;