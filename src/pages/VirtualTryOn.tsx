import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { UploadCloud, Wand2, Loader2, Image as ImageIcon, X, PlusCircle, CheckCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn, sanitizeFilename } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { optimizeImage } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { RealtimeChannel } from "@supabase/supabase-js";
import { SegmentationMask } from "@/components/SegmentationMask";
import { RecentJobThumbnail } from "@/components/RecentJobThumbnail";

interface VtoPipelineJob {
  id: string;
  status: 'pending_segmentation' | 'pending_crop' | 'pending_tryon' | 'pending_composite' | 'complete' | 'failed';
  source_person_image_url: string;
  source_garment_image_url: string;
  cropped_image_url?: string;
  segmentation_result?: {
    masks: { box_2d: [number, number, number, number], label: string }[];
  };
  final_composite_url?: string;
  error_message?: string;
  bitstudio_job?: {
    final_image_url?: string;
  };
}

const ImageUploader = ({ onFileSelect, title, t, imageUrl, onClear }: { onFileSelect: (file: File) => void, title: string, t: any, imageUrl: string | null, onClear: () => void }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (files) => {
      if (files && files[0]) {
        onFileSelect(files[0]);
      }
    }
  });

  if (!imageUrl) {
    return (
      <div 
        {...dropzoneProps}
        className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed border-border p-6 transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")}
        onClick={() => inputRef.current?.click()}
      >
        <div className="text-center pointer-events-none">
          <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-2 font-semibold">{title}</p>
        </div>
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
      </div>
    );
  }

  return (
    <div className="relative aspect-square">
      <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
      <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};

const PipelineStepCard = ({ title, imageUrl, status, children }: { title: string, imageUrl?: string | null, status: 'complete' | 'pending' | 'failed', children?: React.ReactNode }) => {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {status === 'complete' && <CheckCircle className="h-4 w-4 text-green-500" />}
        {status === 'pending' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {status === 'failed' && <X className="h-4 w-4 text-destructive" />}
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="aspect-square bg-muted rounded-lg flex items-center justify-center relative">
        {imageUrl ? (
          <img src={imageUrl} alt={title} className="w-full h-full object-contain rounded-md" />
        ) : (
          status === 'pending' && <p className="text-xs text-muted-foreground">Waiting...</p>
        )}
        {children}
      </div>
    </div>
  );
};

const VirtualTryOn = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [personImageFile, setPersonImageFile] = useState<File | null>(null);
  const [garmentImageFile, setGarmentImageFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const [displayPersonUrl, setDisplayPersonUrl] = useState<string | null>(null);
  const [displayGarmentUrl, setDisplayGarmentUrl] = useState<string | null>(null);
  
  const selectedJobIdRef = useRef(selectedJobId);
  useEffect(() => {
    selectedJobIdRef.current = selectedJobId;
  }, [selectedJobId]);

  const { data: recentJobs, isLoading: isLoadingRecentJobs } = useQuery<VtoPipelineJob[]>({
    queryKey: ['vtoPipelineJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-vto-pipeline-jobs')
        .select('*, bitstudio_job:bitstudio_job_id(final_image_url)')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const { data: selectedJob, isLoading: isLoadingSelectedJob } = useQuery<VtoPipelineJob | null>({
    queryKey: ['vtoPipelineJob', selectedJobId],
    queryFn: async () => {
      if (!selectedJobId) return null;
      const { data, error } = await supabase
        .from('mira-agent-vto-pipeline-jobs')
        .select('*, bitstudio_job:bitstudio_job_id(final_image_url)')
        .eq('id', selectedJobId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!selectedJobId,
  });

  useEffect(() => {
    if (!session?.user) return;
    const channelName = `vto-pipeline-jobs-tracker-${session.user.id}`;
    
    const existingChannel = supabase.channel(channelName);
    if (existingChannel && (existingChannel.state === 'joined' || existingChannel.state === 'joining')) {
        console.log('[VTO Realtime] Already subscribed or joining. Skipping setup.');
        return;
    }

    console.log(`[VTO Realtime] Setting up new subscription to ${channelName}...`);
    const channel = supabase.channel(channelName)
      .on<VtoPipelineJob>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-vto-pipeline-jobs', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          console.log('[VTO Realtime] DB change detected. Invalidating queries.');
          queryClient.invalidateQueries({ queryKey: ['vtoPipelineJobs'] });
          if (payload.new.id === selectedJobIdRef.current) {
            console.log(`[VTO Realtime] Change is for selected job ${selectedJobIdRef.current}. Invalidating its query.`);
            queryClient.invalidateQueries({ queryKey: ['vtoPipelineJob', selectedJobIdRef.current] });
          }
        }
      )
      .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
              console.log(`[VTO Realtime] Successfully subscribed to ${channelName}.`);
          }
          if (status === 'CHANNEL_ERROR') {
              console.error(`[VTO Realtime] Channel subscription error on ${channelName}:`, err);
              showError("Realtime connection failed. Updates may not appear automatically.");
          }
      });
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        console.log(`[VTO Realtime] Cleaning up subscription to ${channelName}.`);
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [supabase, session?.user?.id, queryClient]);

  useEffect(() => {
    let personObjUrl: string | null = null;
    if (personImageFile) {
      personObjUrl = URL.createObjectURL(personImageFile);
      setDisplayPersonUrl(personObjUrl);
    } else if (!selectedJob) {
      setDisplayPersonUrl(null);
    }
    return () => { if (personObjUrl) URL.revokeObjectURL(personObjUrl); };
  }, [personImageFile, selectedJob]);

  useEffect(() => {
    let garmentObjUrl: string | null = null;
    if (garmentImageFile) {
      garmentObjUrl = URL.createObjectURL(garmentImageFile);
      setDisplayGarmentUrl(garmentObjUrl);
    } else if (!selectedJob) {
      setDisplayGarmentUrl(null);
    }
    return () => { if (garmentObjUrl) URL.revokeObjectURL(garmentObjUrl); };
  }, [garmentImageFile, selectedJob]);

  useEffect(() => {
    let personStorageUrl: string | null = null;
    let garmentStorageUrl: string | null = null;

    const downloadAndSet = async (storageUrl: string, setDisplayUrl: React.Dispatch<React.SetStateAction<string | null>>, type: 'person' | 'garment') => {
      try {
        const url = new URL(storageUrl);
        const pathParts = url.pathname.split('/public/mira-agent-user-uploads/');
        if (pathParts.length < 2) throw new Error("Invalid storage URL");
        const storagePath = decodeURIComponent(pathParts[1]);
        
        const { data: blob, error } = await supabase.storage.from('mira-agent-user-uploads').download(storagePath);
        if (error) throw error;

        const newObjUrl = URL.createObjectURL(blob);
        if (type === 'person') personStorageUrl = newObjUrl;
        if (type === 'garment') garmentStorageUrl = newObjUrl;
        setDisplayUrl(newObjUrl);
      } catch (err) {
        console.error(`Failed to download ${type} source image:`, err);
        setDisplayUrl(null);
      }
    };

    if (selectedJob) {
      if (selectedJob.source_person_image_url) downloadAndSet(selectedJob.source_person_image_url, setDisplayPersonUrl, 'person');
      if (selectedJob.source_garment_image_url) downloadAndSet(selectedJob.source_garment_image_url, setDisplayGarmentUrl, 'garment');
    }

    return () => {
      if (personStorageUrl) URL.revokeObjectURL(personStorageUrl);
      if (garmentStorageUrl) URL.revokeObjectURL(garmentStorageUrl);
    };
  }, [selectedJob, supabase.storage]);

  const uploadFileAndGetUrl = async (file: File | null): Promise<string | null> => {
    if (!file) return null;
    if (!session?.user) throw new Error("User session not found.");
    const optimizedFile = await optimizeImage(file);
    const filePath = `${session.user.id}/${Date.now()}-${sanitizeFilename(optimizedFile.name)}`;
    const { error: uploadError } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, optimizedFile);
    if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);
    const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
    return publicUrl;
  };

  const handleTryOn = async () => {
    if (!personImageFile || !garmentImageFile) return showError("Please upload both a person and a garment image.");
    setIsLoading(true);
    const toastId = showLoading("Uploading images and starting pipeline...");
    try {
      const person_image_url = await uploadFileAndGetUrl(personImageFile);
      const garment_image_url = await uploadFileAndGetUrl(garmentImageFile);
      if (!person_image_url || !garment_image_url) throw new Error("Failed to upload one or both images.");
      
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-vto-pipeline', { body: { person_image_url, garment_image_url, user_id: session?.user.id } });
      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("VTO Pipeline job started! It will appear in your history shortly.");
      resetForm();
    } catch (err: any) {
      showError(err.message);
      dismissToast(toastId);
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setPersonImageFile(null);
    setGarmentImageFile(null);
    setSelectedJobId(null);
  };

  const handleJobSelect = (job: VtoPipelineJob) => {
    setPersonImageFile(null);
    setGarmentImageFile(null);
    setSelectedJobId(job.id);
  };

  const renderJobResult = (job: VtoPipelineJob) => {
    const steps = [
      { name: 'Segmentation', status: job.status !== 'pending_segmentation', imageUrl: job.source_person_image_url, children: job.segmentation_result && <SegmentationMask masks={job.segmentation_result.masks} /> },
      { name: 'Cropped Image', status: !['pending_segmentation', 'pending_crop'].includes(job.status), imageUrl: job.cropped_image_url },
      { name: 'AI Try-On', status: !['pending_segmentation', 'pending_crop', 'pending_tryon'].includes(job.status), imageUrl: job.bitstudio_job?.final_image_url },
      { name: 'Final Composite', status: job.status === 'complete', imageUrl: job.final_composite_url }
    ];

    if (job.status === 'failed') {
      return <p className="text-destructive text-sm p-2">Job failed: {job.error_message}</p>;
    }

    return (
      <div className="grid grid-cols-2 gap-4">
        {steps.map((step, index) => (
          <PipelineStepCard 
            key={index} 
            title={step.name} 
            imageUrl={step.imageUrl} 
            status={step.status ? 'complete' : 'pending'}
          >
            {step.children}
          </PipelineStepCard>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b"><h1 className="text-3xl font-bold">{t.virtualTryOn}</h1><p className="text-muted-foreground">Combine a person and a garment image with AI.</p></header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>{selectedJobId ? "Selected Job" : "1. Upload Images"}</CardTitle>
                {selectedJobId && <Button variant="outline" size="sm" onClick={resetForm}><PlusCircle className="h-4 w-4 mr-2" />New Try-On</Button>}
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <ImageUploader onFileSelect={setPersonImageFile} title="Person Image" t={t} imageUrl={displayPersonUrl} onClear={() => { setPersonImageFile(null); if(selectedJobId) setSelectedJobId(null); }} />
              <ImageUploader onFileSelect={setGarmentImageFile} title="Garment Image" t={t} imageUrl={displayGarmentUrl} onClear={() => { setGarmentImageFile(null); if(selectedJobId) setSelectedJobId(null); }} />
            </CardContent>
          </Card>
          {!selectedJobId && (
            <Button onClick={handleTryOn} disabled={isLoading || !personImageFile || !garmentImageFile} className="w-full">{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}Start Virtual Try-On</Button>
          )}
        </div>
        <div className="lg:col-span-2">
          <Card className="min-h-[60vh]">
            <CardHeader><CardTitle>Result</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-center">
              {isLoadingSelectedJob ? <Loader2 className="h-8 w-8 animate-spin" /> : selectedJob ? renderJobResult(selectedJob) : <div className="text-center text-muted-foreground"><ImageIcon className="h-16 w-16 mx-auto mb-4" /><p>Your result will appear here.</p></div>}
            </CardContent>
          </Card>
        </div>
      </div>
      <Card className="mt-8">
        <CardHeader><CardTitle>Recent Try-Ons</CardTitle></CardHeader>
        <CardContent>
          {isLoadingRecentJobs ? (
            <div className="flex gap-4"><Skeleton className="h-24 w-24" /><Skeleton className="h-24 w-24" /><Skeleton className="h-24 w-24" /></div>
          ) : recentJobs && recentJobs.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {recentJobs.map(job => (
                <RecentJobThumbnail
                  key={job.id}
                  job={job}
                  onClick={() => handleJobSelect(job)}
                  isSelected={selectedJobId === job.id}
                />
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No recent jobs found.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default VirtualTryOn;