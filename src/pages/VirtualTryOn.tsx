import React, { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { UploadCloud, Wand2, Loader2, Image as ImageIcon, X, PlusCircle, CheckCircle, AlertTriangle, Settings, Trash2, Brush, Crop } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ManualCropModal } from "@/components/Editor/ManualCropModal";

interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  source_person_image_url: string;
  source_garment_image_url: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'pro';
}

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear, onCrop, canCrop }: { onFileSelect: (file: File) => void, title: string, imageUrl: string | null, onClear: () => void, onCrop?: () => void, canCrop?: boolean }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files[0]) });

  if (imageUrl) {
    return (
      <div className="relative aspect-square group">
        <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
        <div className="absolute top-2 right-2 z-10 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="destructive" size="icon" className="h-6 w-6" onClick={onClear}><X className="h-4 w-4" /></Button>
          {canCrop && onCrop && <Button variant="secondary" size="icon" className="h-6 w-6" onClick={onCrop}><Crop className="h-4 w-4" /></Button>}
        </div>
      </div>
    );
  }

  return (
    <div {...dropzoneProps} className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed p-6 transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
      <div className="text-center pointer-events-none"><UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" /><p className="mt-2 font-semibold">{title}</p></div>
      <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files[0])} />
    </div>
  );
};

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
});

const dataUrlToBlob = async (dataUrl: string): Promise<Blob> => {
    const res = await fetch(dataUrl);
    return await res.blob();
};

const VirtualTryOn = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  
  const [personImageFile, setPersonImageFile] = useState<File | null>(null);
  const [garmentImageFile, setGarmentImageFile] = useState<File | null>(null);
  const [croppedPersonImageFile, setCroppedPersonImageFile] = useState<File | null>(null);
  const [maskImageDataUrl, setMaskImageDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [mode, setMode] = useState<'base' | 'pro'>('base');
  const [isCropModalOpen, setIsCropModalOpen] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const { data: recentJobs, isLoading: isLoadingRecentJobs } = useQuery<BitStudioJob[]>({
    queryKey: ['bitstudioJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => recentJobs?.find(job => job.id === selectedJobId), [recentJobs, selectedJobId]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const channel = supabase.channel(`bitstudio-jobs-tracker-${session.user.id}`)
      .on<BitStudioJob>('postgres_changes', { event: '*', schema: 'public', table: 'mira-agent-bitstudio-jobs', filter: `user_id=eq.${session.user.id}` },
        () => queryClient.invalidateQueries({ queryKey: ['bitstudioJobs'] })
      ).subscribe();
    channelRef.current = channel;
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [supabase, session?.user?.id, queryClient]);

  const personImageUrl = useMemo(() => personImageFile ? URL.createObjectURL(personImageFile) : null, [personImageFile]);
  const garmentImageUrl = useMemo(() => garmentImageFile ? URL.createObjectURL(garmentImageFile) : null, [garmentImageFile]);
  const croppedPersonImageUrl = useMemo(() => croppedPersonImageFile ? URL.createObjectURL(croppedPersonImageFile) : null, [croppedPersonImageFile]);

  const handleTryOn = async () => {
    const personFileToUse = croppedPersonImageFile || personImageFile;
    if (!personFileToUse || !garmentImageFile || !session?.user) return showError("Please select both a person and a garment image.");
    if (mode === 'pro' && !maskImageDataUrl) return showError("Please draw a mask on the person image for Pro mode.");

    setIsLoading(true);
    const toastId = showLoading("Preparing your virtual try-on...");
    try {
      const [person_image_data, garment_image_data] = await Promise.all([
        fileToBase64(personFileToUse),
        fileToBase64(garmentImageFile)
      ]);
      
      const payload: any = {
        person_image_data,
        garment_image_data,
        mode,
        user_id: session.user.id,
        prompt: mode === 'pro' ? "wearing this garment" : "professional portrait, high quality"
      };

      if (mode === 'pro' && maskImageDataUrl) {
        payload.mask_image_data = maskImageDataUrl.split(',')[1];
      }

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio-vto', { body: payload });
      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("Job started! Your result will appear below shortly.");
      resetForm();
      setSelectedJobId(data.jobId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to start job: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setPersonImageFile(null);
    setGarmentImageFile(null);
    setCroppedPersonImageFile(null);
    setSelectedJobId(null);
    setMaskImageDataUrl(null);
  };

  const handleCropComplete = async (croppedDataUrl: string) => {
    const blob = await dataUrlToBlob(croppedDataUrl);
    const file = new File([blob], "cropped_person.webp", { type: "image/webp" });
    setCroppedPersonImageFile(file);
  };

  const renderJobResult = (job: BitStudioJob) => {
    if (job.status === 'failed') return <p className="text-destructive text-sm p-2">Job failed: {job.error_message}</p>;
    if (job.status === 'complete' && job.final_image_url) {
      return <SecureImageDisplay imageUrl={job.final_image_url} alt="Final Result" />;
    }
    return (
      <div className="text-center text-muted-foreground">
        <Loader2 className="h-12 w-12 mx-auto animate-spin" />
        <p className="mt-4">Job status: {job.status}</p>
      </div>
    );
  };

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b"><h1 className="text-3xl font-bold">{t('virtualTryOn')}</h1></header>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader><div className="flex justify-between items-center"><CardTitle>{selectedJobId ? "Selected Job" : "1. Upload Images"}</CardTitle>{selectedJobId && <Button variant="outline" size="sm" onClick={resetForm}><PlusCircle className="h-4 w-4 mr-2" />New</Button>}</div></CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                {selectedJob ? <SecureImageDisplay imageUrl={selectedJob.source_person_image_url} alt="Person" /> : <ImageUploader onFileSelect={setPersonImageFile} title="Person Image" imageUrl={croppedPersonImageUrl || personImageUrl} onClear={() => { setPersonImageFile(null); setCroppedPersonImageFile(null); }} onCrop={() => setIsCropModalOpen(true)} canCrop={!!personImageFile} />}
                {selectedJob ? <SecureImageDisplay imageUrl={selectedJob.source_garment_image_url} alt="Garment" /> : <ImageUploader onFileSelect={setGarmentImageFile} title="Garment Image" imageUrl={garmentImageUrl} onClear={() => setGarmentImageFile(null)} />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>2. Select Mode</CardTitle></CardHeader>
              <CardContent>
                <RadioGroup value={mode} onValueChange={(v) => setMode(v as 'base' | 'pro')} className="space-y-2">
                  <div className="flex items-center space-x-2"><RadioGroupItem value="base" id="mode-base" /><Label htmlFor="mode-base">Base</Label></div>
                  <div className="flex items-center space-x-2"><RadioGroupItem value="pro" id="mode-pro" /><Label htmlFor="mode-pro">Pro (Inpainting)</Label></div>
                </RadioGroup>
              </CardContent>
            </Card>
            {mode === 'pro' && (
              <Card>
                <CardHeader><CardTitle>3. Create Mask</CardTitle></CardHeader>
                <CardContent>
                  {personImageUrl ? <MaskCanvas imageUrl={personImageUrl} onMaskChange={setMaskImageDataUrl} /> : <p className="text-sm text-muted-foreground">Upload a person image to create a mask.</p>}
                </CardContent>
              </Card>
            )}
            <Button onClick={handleTryOn} disabled={isLoading || !personImageFile || !garmentImageFile || (mode === 'pro' && !maskImageDataUrl)} className="w-full">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Start Virtual Try-On
            </Button>
          </div>
          <div className="lg:col-span-2">
            <Card className="min-h-[60vh]">
              <CardHeader><CardTitle>Result</CardTitle></CardHeader>
              <CardContent className="flex items-center justify-center">
                {selectedJob ? renderJobResult(selectedJob) : <div className="text-center text-muted-foreground"><ImageIcon className="h-16 w-16 mx-auto mb-4" /><p>Your result will appear here.</p></div>}
              </CardContent>
            </Card>
            <Card className="mt-8">
              <CardHeader><CardTitle>Recent Jobs</CardTitle></CardHeader>
              <CardContent>
                {isLoadingRecentJobs ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
                  <div className="flex gap-4 overflow-x-auto pb-2">
                    {recentJobs.map(job => (
                      <button key={job.id} onClick={() => setSelectedJobId(job.id)} className={cn("border-2 rounded-lg p-1 flex-shrink-0", selectedJobId === job.id ? "border-primary" : "border-transparent")}>
                        <SecureImageDisplay imageUrl={job.final_image_url || job.source_person_image_url} alt="Recent job" />
                      </button>
                    ))}
                  </div>
                ) : <p className="text-muted-foreground text-sm">No recent jobs found.</p>}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      {personImageUrl && <ManualCropModal isOpen={isCropModalOpen} onClose={() => setIsCropModalOpen(false)} imageUrl={personImageUrl} onCropComplete={handleCropComplete} />}
    </>
  );
};

const SecureImageDisplay = ({ imageUrl, alt }: { imageUrl: string | null, alt: string }) => {
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
  if (!imageUrl) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
  if (isLoading) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
  return <img src={displayUrl} alt={alt} className="w-full h-full object-cover rounded-md" />;
};

export default VirtualTryOn;