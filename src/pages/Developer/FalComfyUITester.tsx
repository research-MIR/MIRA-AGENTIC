import { useState, useRef, useCallback, useEffect } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, UploadCloud, Play, Check, X, Hourglass } from 'lucide-react';
import { showError, showSuccess } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RealtimeChannel } from '@supabase/supabase-js';

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

const FalComfyUITester = () => {
  const { supabase, session } = useSession();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [params, setParams] = useState({
    ksampler_denoise: 0.1,
    imagescaleby_scale_by: 0.5,
    controlnetapplyadvanced_strength: 0.3,
    controlnetapplyadvanced_end_percent: 0.9,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const addLog = (message: string) => {
    setLogs(prev => [`${new Date().toLocaleTimeString()}: ${message}`, ...prev]);
  };

  useEffect(() => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    if (jobId) {
      addLog(`Subscribing to real-time updates for job ${jobId}...`);
      const channel = supabase.channel(`fal_job_${jobId}`);
      channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'fal_comfyui_jobs', filter: `id=eq.${jobId}` },
        (payload) => {
          const newJob = payload.new as any;
          addLog(`[REALTIME] Job status updated: ${newJob.status}`);
          setJobStatus(newJob.status);
          if (newJob.status === 'complete') {
            const imageUrl = newJob.final_result?.data?.images?.[0]?.url;
            if (imageUrl) {
              setResultImageUrl(imageUrl);
              showSuccess("Job complete!");
            } else {
              addLog("[ERROR] Job completed but no image URL found in result.");
              showError("Job completed but no image URL found in result.");
            }
            setIsLoading(false);
          } else if (newJob.status === 'failed') {
            addLog(`[ERROR] Job failed: ${newJob.error_message}`);
            showError(`Job failed: ${newJob.error_message}`);
            setIsLoading(false);
          }
        }
      ).subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          addLog("Successfully subscribed to real-time updates.");
        }
        if (status === 'CHANNEL_ERROR') {
          addLog(`[ERROR] Realtime connection failed: ${err?.message}`);
          showError("Could not connect to real-time updates. You may need to enable Realtime for the 'fal_comfyui_jobs' table in your Supabase dashboard.");
        }
      });
      channelRef.current = channel;
    }

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [jobId, supabase]);

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => setImagePreview(event.target?.result as string);
  }, []);

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0]),
  });

  const handleSubmit = async () => {
    if (!imageFile || !session?.user) return showError("Please upload an image and be logged in.");
    setIsLoading(true);
    setLogs([]);
    setResultImageUrl(null);
    setJobId(null);
    setJobStatus('submitting');
    addLog("Submitting job...");
    try {
      const image_base64 = await fileToBase64(imageFile);
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-fal-comfyui', {
        body: { method: 'submit', input: params, image_base64, mime_type: imageFile.type, user_id: session.user.id }
      });
      if (error) throw error;
      setJobId(data.jobId);
      setJobStatus('queued');
      addLog(`Job submitted successfully. DB Job ID: ${data.jobId}`);
      showSuccess("Job submitted and is now being monitored.");
    } catch (err: any) {
      addLog(`Error submitting job: ${err.message}`);
      showError(err.message);
      setJobStatus('failed');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = () => {
    if (isLoading && jobStatus === 'submitting') return <Loader2 className="h-4 w-4 animate-spin" />;
    switch (jobStatus) {
      case 'complete': return <Check className="h-4 w-4 text-green-500" />;
      case 'failed': return <X className="h-4 w-4 text-destructive" />;
      case 'processing':
      case 'queued':
        return <Hourglass className="h-4 w-4 text-blue-500 animate-pulse" />;
      default:
        return null;
    }
  };

  return (
    <div className="p-4 md:p-8 h-full overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">Fal.ai ComfyUI Tester (Autonomous)</h1>
        <p className="text-muted-foreground">Submit a job and the backend will automatically monitor it and fetch the result.</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>1. Inputs</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer", isDraggingOver && "border-primary")}>
                {imagePreview ? <img src={imagePreview} alt="Preview" className="max-h-40 mx-auto rounded-md" /> : <><UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-xs font-medium">Click or drag source image</p></>}
                <Input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} />
              </div>
              <div>
                <Label>Denoise: {params.ksampler_denoise.toFixed(2)}</Label>
                <Slider value={[params.ksampler_denoise]} onValueChange={(v) => setParams(p => ({ ...p, ksampler_denoise: v[0] }))} min={0} max={1} step={0.01} />
              </div>
              <div>
                <Label>Scale By: {params.imagescaleby_scale_by.toFixed(2)}</Label>
                <Slider value={[params.imagescaleby_scale_by]} onValueChange={(v) => setParams(p => ({ ...p, imagescaleby_scale_by: v[0] }))} min={0.1} max={2} step={0.01} />
              </div>
              <div>
                <Label>Strength: {params.controlnetapplyadvanced_strength.toFixed(2)}</Label>
                <Slider value={[params.controlnetapplyadvanced_strength]} onValueChange={(v) => setParams(p => ({ ...p, controlnetapplyadvanced_strength: v[0] }))} min={0} max={1} step={0.01} />
              </div>
              <div>
                <Label>End Percent: {params.controlnetapplyadvanced_end_percent.toFixed(2)}</Label>
                <Slider value={[params.controlnetapplyadvanced_end_percent]} onValueChange={(v) => setParams(p => ({ ...p, controlnetapplyadvanced_end_percent: v[0] }))} min={0} max={1} step={0.01} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>2. Action</CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {getStatusIcon()}
                  <span>{jobStatus || 'Idle'}</span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button variant="default" onClick={handleSubmit} disabled={isLoading || !imageFile} className="w-full"><Play className="mr-2 h-4 w-4" />Submit & Monitor Job</Button>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Logs</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-64 w-full bg-muted rounded-md">
                <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all">{logs.join('\n')}</pre>
              </ScrollArea>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Result Image</CardTitle></CardHeader>
            <CardContent>
              <div className="aspect-square bg-muted rounded-md flex items-center justify-center">
                {isLoading && jobStatus !== 'submitting' && <Loader2 className="h-8 w-8 animate-spin" />}
                {resultImageUrl && <img src={resultImageUrl} alt="Final result" className="max-w-full max-h-full object-contain" />}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default FalComfyUITester;