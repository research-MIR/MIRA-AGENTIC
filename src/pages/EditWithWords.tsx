import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Image as ImageIcon, Wand2, UploadCloud, X, Palette } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { RecentJobThumbnail } from "@/components/Jobs/RecentJobThumbnail";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

interface EditJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: {
    publicUrl: string;
  };
  metadata?: {
    source_image_url?: string;
    reference_image_urls?: string[];
    prompt?: string;
  };
  error_message?: string;
}

const SecureDisplayImage = ({ imageUrl, alt }: { imageUrl: string | null, alt: string }) => {
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl);

  if (!imageUrl) return null;

  return (
    <div className="relative w-full h-full">
      {isLoading && <Skeleton className="w-full h-full" />}
      {error && <div className="w-full h-full bg-destructive/10 rounded-md flex items-center justify-center text-destructive text-sm p-2">Error loading image.</div>}
      {displayUrl && <img src={displayUrl} alt={alt} className="w-full h-full object-contain" />}
    </div>
  );
};

const FileUploader = ({ onFileSelect, title, imageUrl, onClear, icon, multiple = false }: { onFileSelect: (files: FileList) => void, title: string, imageUrl?: string | null, onClear?: () => void, icon: React.ReactNode, multiple?: boolean }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files) });
  
    if (imageUrl && onClear) {
      return (
        <div className="relative h-48 w-full">
          <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}><X className="h-4 w-4" /></Button>
        </div>
      );
    }
  
    return (
      <div {...dropzoneProps} className={cn("flex flex-col h-48 w-full justify-center items-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        <div className="text-center pointer-events-none">{icon}<p className="mt-2 text-sm font-semibold">{title}</p></div>
        <Input ref={inputRef} type="file" multiple={multiple} className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files)} />
      </div>
    );
};

const EditWithWords = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [instruction, setInstruction] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);

  const sourceImageUrl = useMemo(() => sourceFile ? URL.createObjectURL(sourceFile) : null, [sourceFile]);
  const referenceImageUrls = useMemo(() => referenceFiles.map(f => URL.createObjectURL(f)), [referenceFiles]);

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery<EditJob[]>({
    queryKey: ['recentEditJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-comfyui-jobs')
        .select('id, status, final_result, metadata, error_message')
        .eq('metadata->>source', 'edit-with-words')
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
    setSourceFile(null);
    setReferenceFiles([]);
    setInstruction("");
  };

  const handleSubmit = async () => {
    if (!sourceFile) return showError("Please upload an image to edit.");
    if (!instruction.trim()) return showError("Please provide an editing instruction.");
    
    setIsSubmitting(true);
    const toastId = showLoading(t('sendingJob'));

    try {
        const uploadFile = async (file: File, type: 'source' | 'reference') => {
            const filePath = `${session?.user?.id}/edit-${type}/${Date.now()}-${file.name}`;
            const { data, error } = await supabase.storage
                .from('mira-agent-user-uploads')
                .upload(filePath, file);
            if (error) throw error;
            return supabase.storage.from('mira-agent-user-uploads').getPublicUrl(data.path).data.publicUrl;
        };

        const sourcePublicUrl = await uploadFile(sourceFile, 'source');
        const referencePublicUrls = await Promise.all(referenceFiles.map(file => uploadFile(file, 'reference')));

        dismissToast(toastId);
        showLoading("Sending job to the image editor...");

        const payload = {
            source_image_url: sourcePublicUrl,
            instruction: instruction,
            reference_image_urls: referencePublicUrls,
            invoker_user_id: session?.user?.id,
        };

        const { error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-edit-with-words', { body: payload });

        if (proxyError) throw proxyError;
        
        dismissToast(toastId);
        showSuccess("Edit job started! You can track its progress in the sidebar.");
        queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
        queryClient.invalidateQueries({ queryKey: ['recentEditJobs'] });
        startNew();
    } catch (err: any) {
        dismissToast(toastId);
        showError(`Job submission failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">{t('editWithWords')}</h1>
          <p className="text-muted-foreground">{t('editWithWordsDescription')}</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader><CardTitle>1. Provide Images</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label>{t('sourceImage')}</Label>
                    <FileUploader onFileSelect={(files) => files && setSourceFile(files[0])} title="Source" imageUrl={sourceImageUrl} onClear={() => setSourceFile(null)} icon={<ImageIcon className="h-8 w-8 text-muted-foreground" />} />
                </div>
                <div className="space-y-2">
                    <Label>{t('referenceImage')}</Label>
                    <FileUploader onFileSelect={(files) => files && setReferenceFiles(Array.from(files))} title="Reference(s)" icon={<Palette className="h-8 w-8 text-muted-foreground" />} multiple />
                    {referenceImageUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2">
                            {referenceImageUrls.map((url, index) => (
                                <div key={index} className="relative">
                                    <img src={url} alt={`Reference ${index}`} className="w-16 h-16 object-cover rounded-md" />
                                    <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-5 w-5 rounded-full" onClick={() => setReferenceFiles(files => files.filter((_, i) => i !== index))}><X className="h-3 w-3" /></Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>2. {t('editingInstruction')}</CardTitle></CardHeader>
              <CardContent>
                <Textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t('instructionPlaceholder')} rows={4} />
              </CardContent>
            </Card>
            <Button size="lg" className="w-full" onClick={handleSubmit} disabled={isSubmitting || !sourceFile || !instruction.trim()}>
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
                        <SecureDisplayImage imageUrl={selectedJob.metadata?.source_image_url || null} alt="Original" />
                      </div>
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center relative">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">{t('result')}</h3>
                        {selectedJob.status === 'complete' && selectedJob.final_result?.publicUrl ? (
                          <SecureDisplayImage imageUrl={selectedJob.final_result.publicUrl} alt="Result" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <p className="mt-2 text-sm">{t('inProgress')}</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedJob.status === 'complete' && selectedJob.final_result?.publicUrl && (
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
              <CardHeader><CardTitle>{t('recentEdits')}</CardTitle></CardHeader>
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
                  <p className="text-sm text-muted-foreground">{t('noRecentEdits')}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      {isCompareModalOpen && selectedJob?.metadata?.source_image_url && selectedJob?.final_result?.publicUrl && (
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

export default EditWithWords;