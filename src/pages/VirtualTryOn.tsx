import React, { useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { UploadCloud, Wand2, Loader2, Image as ImageIcon, X, PlusCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { optimizeImage } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { RealtimeChannel } from "@supabase/supabase-js";

// This will now point to the new pipeline job table
interface VtoPipelineJob {
  id: string;
  status: 'pending_segmentation' | 'pending_crop' | 'pending_tryon' | 'pending_composite' | 'complete' | 'failed';
  source_person_image_url: string;
  source_garment_image_url: string;
  final_composite_url?: string;
  error_message?: string;
}

const ImageUploader = ({ onFileSelect, title, isDraggingOver, t, imageUrl, onClear }: { onFileSelect: (file: File) => void, title: string, isDraggingOver: boolean, t: any, imageUrl: string | null, onClear: () => void }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
  };

  const { dropzoneProps } = useDropzone({
    onDrop: (files) => {
      if (files && files[0]) {
        onFileSelect(files[0]);
      }
    }
  });

  if (imageUrl) {
    return (
      <div className="relative">
        <img src={imageUrl} alt={title} className="w-full h-48 object-cover rounded-md" />
        <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={onClear}>
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div 
      {...dropzoneProps}
      className={cn("flex h-48 justify-center items-center rounded-lg border border-dashed border-border p-6 transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")}
      onClick={() => inputRef.current?.click()}
    >
      <div className="text-center pointer-events-none">
        <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-2 font-semibold">{title}</p>
      </div>
      <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
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
  const [selectedJob, setSelectedJob] = useState<VtoPipelineJob | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const personImageUrl = useMemo(() => personImageFile ? URL.createObjectURL(personImageFile) : null, [personImageFile]);
  const garmentImageUrl = useMemo(() => garmentImageFile ? URL.createObjectURL(garmentImageFile) : null, [garmentImageFile]);

  const { data: recentJobs, isLoading: isLoadingRecentJobs } = useQuery<VtoPipelineJob[]>({
    queryKey: ['vtoPipelineJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('mira-agent-vto-pipeline-jobs')
        .select('*')
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
    const channel = supabase.channel('vto-pipeline-jobs-tracker')
      .on<VtoPipelineJob>(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mira-agent-vto-pipeline-jobs', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ['vtoPipelineJobs', session.user.id] });
          if (selectedJob && payload.new.id === selectedJob.id) {
            setSelectedJob(payload.new as VtoPipelineJob);
          }
        }
      ).subscribe();
    channelRef.current = channel;
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [supabase, session?.user?.id, queryClient, selectedJob]);

  const uploadFileAndGetUrl = async (file: File | null): Promise<string | null> => {
    if (!file) return null;
    if (!session?.user) throw new Error("User session not found.");
    const optimizedFile = await optimizeImage(file);
    const filePath = `${session.user.id}/${Date.now()}-${optimizedFile.name}`;
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
    setSelectedJob(null);
  };

  const renderJobResult = (job: VtoPipelineJob) => {
    switch (job.status) {
      case 'pending_segmentation':
      case 'pending_crop':
      case 'pending_tryon':
      case 'pending_composite':
        return <div className="flex flex-col items-center justify-center h-full text-muted-foreground"><Loader2 className="mr-2 h-8 w-8 animate-spin" /> <p className="mt-2 text-sm capitalize">{job.status.replace('_', ' ')}...</p></div>;
      case 'complete':
        return job.final_composite_url ? <img src={job.final_composite_url} alt="Virtual Try-On Result" className="w-full h-full object-contain rounded-md" /> : <p>Job complete, but no image URL found.</p>;
      case 'failed':
        return <p className="text-destructive text-sm p-2">Job failed: {job.error_message}</p>;
      default:
        return null;
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b"><h1 className="text-3xl font-bold">{t.virtualTryOn}</h1><p className="text-muted-foreground">Combine a person and a garment image with AI.</p></header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>1. Upload Images</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <ImageUploader onFileSelect={setPersonImageFile} title="Person Image" isDraggingOver={false} t={t} imageUrl={personImageUrl} onClear={() => setPersonImageFile(null)} />
              <ImageUploader onFileSelect={setGarmentImageFile} title="Garment Image" isDraggingOver={false} t={t} imageUrl={garmentImageUrl} onClear={() => setGarmentImageFile(null)} />
            </CardContent>
          </Card>
          <Button onClick={handleTryOn} disabled={isLoading || !personImageFile || !garmentImageFile} className="w-full">{isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}Start Virtual Try-On</Button>
        </div>
        <div className="lg:col-span-2">
          <Card className="min-h-[60vh]">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Result</CardTitle>
                {selectedJob && <Button variant="outline" size="sm" onClick={resetForm}><PlusCircle className="h-4 w-4 mr-2" />New Try-On</Button>}
              </div>
            </CardHeader>
            <CardContent className="h-[50vh] flex items-center justify-center">
              {selectedJob ? renderJobResult(selectedJob) : <div className="text-center text-muted-foreground"><ImageIcon className="h-16 w-16 mx-auto mb-4" /><p>Your result will appear here.</p></div>}
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
                <button key={job.id} onClick={() => setSelectedJob(job)} className={cn("border-2 rounded-lg p-1 flex-shrink-0", selectedJob?.id === job.id ? "border-primary" : "border-transparent")}>
                  <img src={job.source_person_image_url} alt="Job source" className="w-24 h-24 object-cover rounded-md" />
                </button>
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