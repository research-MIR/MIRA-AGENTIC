import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UploadCloud, Play, Check, X, Hourglass } from 'lucide-react';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Textarea } from '@/components/ui/textarea';

const UPLOAD_BUCKET = 'enhancor-ai-uploads';

const findImageUrlInResult = (result: any): string | null => {
  if (!result?.data?.outputs) {
    return null;
  }
  const outputs = result.data.outputs;
  for (const nodeId in outputs) {
    const node = outputs[nodeId];
    if (node?.images && Array.isArray(node.images) && node.images.length > 0) {
      const imageUrl = node.images[0]?.url;
      if (imageUrl) {
        return imageUrl;
      }
    }
  }
  return null;
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
  const [prompt, setPrompt] = useState<string>('');
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
            const imageUrl = findImageUrlInResult(newJob.final_result);
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
    addLog("Uploading source image...");

    try {
      const filePath = `${session.user.id}/fal-comfy-tests/${Date.now()}-${imageFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .upload(filePath, imageFile, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl: source_image_url } } = supabase.storage
        .from(UPLOAD_BUCKET)
        .getPublicUrl(filePath);
      addLog(`Image uploaded: ${source_image_url}`);

      const tile_id = crypto.randomUUID();
      addLog(`Using dummy tile_id: ${tile_id}`);

      addLog("Submitting job to proxy...");
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui-tiled-upscale', {
        body: { 
          user_id: session.user.id,
          source_image_url,
          prompt,
          tile_id
        }
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
                <Label>Prompt</Label>
                <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g., a photorealistic image of..." />
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