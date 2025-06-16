import { useState, useEffect, useRef } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { useLanguage } from "@/context/LanguageContext";
import { Loader2, AlertTriangle, Image as ImageIcon } from "lucide-react";
import { RealtimeChannel } from "@supabase/supabase-js";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { optimizeImage } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ComfyJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: { publicUrl: string };
  error_message?: string;
}

const formatBytes = (bytes: number, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

const Developer = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const queryClient = useQueryClient();
  const [isCancelling, setIsCancelling] = useState(false);

  // ComfyUI State
  const [activeJob, setActiveJob] = useState<ComfyJob | null>(null);
  const [comfyPrompt, setComfyPrompt] = useState("");
  const [sourceImage, setSourceImage] = useState<File | null>(null);

  // Image Optimizer State
  const [originalImage, setOriginalImage] = useState<File | null>(null);
  const [optimizedImage, setOptimizedImage] = useState<File | null>(null);
  const [quality, setQuality] = useState(80);

  // Segmentation State
  const [segmentationImage, setSegmentationImage] = useState<File | null>(null);
  const [segmentationResult, setSegmentationResult] = useState<string | null>(null);
  const [isSegmenting, setIsSegmenting] = useState(false);

  const originalImageUrl = originalImage ? URL.createObjectURL(originalImage) : null;
  const optimizedImageUrl = optimizedImage ? URL.createObjectURL(optimizedImage) : null;

  useEffect(() => {
    return () => {
      if (channelRef.current) {
        console.log("[DevPage] Cleaning up Realtime channel.");
        supabase.removeChannel(channelRef.current);
      }
      if (originalImageUrl) URL.revokeObjectURL(originalImageUrl);
      if (optimizedImageUrl) URL.revokeObjectURL(optimizedImageUrl);
    };
  }, [supabase, originalImageUrl, optimizedImageUrl]);

  const handleImageTestChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setOriginalImage(file);
    }
  };

  useEffect(() => {
    if (originalImage) {
      optimizeImage(originalImage, quality / 100).then(setOptimizedImage);
    }
  }, [originalImage, quality]);

  const handleQueuePrompt = async () => {
    if (!session?.user) return showError("You must be logged in to queue a job.");
    if (!sourceImage) return showError("A source image is required for this workflow.");
    if (!comfyPrompt.trim()) return showError("A prompt is required for this workflow.");

    setActiveJob({ id: '', status: 'queued' });
    let toastId = showLoading("Uploading source image...");

    try {
      const uploadFormData = new FormData();
      uploadFormData.append('image', sourceImage);
      
      const { data: uploadResult, error: uploadError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui-upload', {
          body: uploadFormData
      });

      if (uploadError) throw new Error(`Image upload failed: ${uploadError.message}`);
      const uploadedFilename = uploadResult.name;
      if (!uploadedFilename) throw new Error("ComfyUI did not return a filename for the uploaded image.");
      
      dismissToast(toastId);
      toastId = showLoading("Sending prompt to ComfyUI...");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          prompt_text: comfyPrompt,
          image_filename: uploadedFilename,
          invoker_user_id: session.user.id
        }
      });

      if (error) throw error;
      
      const { jobId } = data;
      if (!jobId) throw new Error("Did not receive a job ID from the server.");
      
      dismissToast(toastId);
      showSuccess("ComfyUI job queued. Waiting for result...");
      setActiveJob({ id: jobId, status: 'queued' });

      if (channelRef.current) supabase.removeChannel(channelRef.current);

      channelRef.current = supabase.channel(`comfyui-job-${jobId}`)
        .on<ComfyJob>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'mira-agent-comfyui-jobs', filter: `id=eq.${jobId}` },
          (payload) => {
            console.log('[DevPage] Realtime update received:', payload.new);
            setActiveJob(payload.new as ComfyJob);
            if (payload.new.status === 'complete' || payload.new.status === 'failed') {
              supabase.removeChannel(channelRef.current!);
              channelRef.current = null;
            }
          }
        )
        .subscribe();

    } catch (err: any) {
      setActiveJob(null);
      showError(`Failed to queue prompt: ${err.message}`);
      console.error("[DevPage] Error in handleQueuePrompt:", err);
      dismissToast(toastId);
    }
  };

  const handleCancelAllJobs = async () => {
    if (!session?.user) return showError("You must be logged in.");
    setIsCancelling(true);
    const toastId = showLoading("Cancelling all active jobs...");
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-cancel-all-my-jobs', {
        body: { user_id: session.user.id }
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess(data.message || "All active jobs have been cancelled.");
      queryClient.invalidateQueries({ queryKey: ['activeComfyJobs'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to cancel jobs: ${err.message}`);
    } finally {
      setIsCancelling(false);
    }
  };

  const handleSegmentation = async () => {
    if (!segmentationImage) return showError("Please select an image for segmentation.");
    setIsSegmenting(true);
    setSegmentationResult(null);
    const toastId = showLoading("Sending image to segmentation AI...");

    try {
        const reader = new FileReader();
        reader.readAsDataURL(segmentationImage);
        reader.onloadend = async () => {
            const base64String = reader.result as string;
            const base64Data = base64String.split(',')[1];

            const { data, error } = await supabase.functions.invoke('MIRA-AGENT-segment-ai', {
                body: {
                    base64_image_data: base64Data,
                    mime_type: segmentationImage.type
                }
            });

            if (error) throw error;

            setSegmentationResult(JSON.stringify(data, null, 2));
            dismissToast(toastId);
            showSuccess("Segmentation analysis complete.");
        };
        reader.onerror = (error) => {
            throw error;
        };
    } catch (err: any) {
        showError(`Segmentation failed: ${err.message}`);
        dismissToast(toastId);
    } finally {
        setIsSegmenting(false);
    }
  };

  const renderJobStatus = () => {
    if (!activeJob) return <p className="text-center text-muted-foreground">{t.resultsPlaceholder}</p>;

    switch (activeJob.status) {
      case 'queued':
        return <div className="flex items-center justify-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Waiting in queue...</div>;
      case 'processing':
        return <div className="flex items-center justify-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating image...</div>;
      case 'complete':
        return activeJob.final_result?.publicUrl ? (
          <img src={activeJob.final_result.publicUrl} alt="Generated by ComfyUI" className="max-w-full mx-auto rounded-lg" />
        ) : <p>Job complete, but no image URL found.</p>;
      case 'failed':
        return <p className="text-destructive">Job failed: {activeJob.error_message}</p>;
      default:
        return null;
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t.developerTools}</h1>
        <p className="text-muted-foreground">{t.developerToolsDescription}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>AI Segmentation Tester</CardTitle></CardHeader>
            <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">Upload an image to get a JSON description from the AI.</p>
                <Input
                    id="segmentation-upload"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setSegmentationImage(e.target.files?.[0] || null)}
                />
                <Button onClick={handleSegmentation} disabled={isSegmenting || !segmentationImage}>
                    {isSegmenting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Analyze Image
                </Button>
                {segmentationResult && (
                    <div>
                        <Label>JSON Response</Label>
                        <Textarea
                            readOnly
                            value={segmentationResult}
                            className="mt-1 h-48 font-mono text-xs"
                        />
                    </div>
                )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Image Optimization Tester</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Input id="image-test-upload" type="file" accept="image/*" onChange={handleImageTestChange} />
              {originalImage && (
                <div className="space-y-4">
                  <div>
                    <Label>Quality: {quality}%</Label>
                    <Slider value={[quality]} onValueChange={(v) => setQuality(v[0])} min={10} max={100} step={5} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-semibold text-center">Original</h4>
                      {originalImageUrl && <img src={originalImageUrl} alt="Original" className="w-full rounded-md mt-2" />}
                      <p className="text-sm text-center text-muted-foreground mt-1">{formatBytes(originalImage.size)}</p>
                    </div>
                    <div>
                      <h4 className="font-semibold text-center">Optimized (WebP)</h4>
                      {optimizedImageUrl && <img src={optimizedImageUrl} alt="Optimized" className="w-full rounded-md mt-2" />}
                      {optimizedImage && <p className="text-sm text-center text-muted-foreground mt-1">{formatBytes(optimizedImage.size)}</p>}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                    <AlertTriangle />
                    Danger Zone
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                    These actions are irreversible. Use with caution.
                </p>
                <AlertDialog>
                    <AlertDialogTrigger asChild>
                        <Button variant="destructive" disabled={isCancelling}>
                            {isCancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Cancel All My Active Jobs
                        </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                                This will immediately stop and fail all of your jobs that are currently queued or processing across all systems. This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={handleCancelAllJobs}>
                                Yes, cancel all jobs
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </CardContent>
          </Card>
        </div>
        <div>
          <Card>
            <CardHeader><CardTitle>{t.results}</CardTitle></CardHeader>
            <CardContent className="min-h-[300px] flex items-center justify-center">
              {renderJobStatus()}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Developer;