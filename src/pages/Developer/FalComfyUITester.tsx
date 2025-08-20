import { useState, useRef, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, UploadCloud, Wand2, Play, FileClock, CheckSquare } from 'lucide-react';
import { showError, showSuccess } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SUPABASE_PUBLISHABLE_KEY } from '@/integrations/supabase/client';

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

const FalComfyUITester = () => {
  const { supabase } = useSession();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [params, setParams] = useState({
    ksampler_denoise: 0.1,
    imagescaleby_scale_by: 0.5,
    controlnetapplyadvanced_strength: 0.3,
    controlnetapplyadvanced_end_percent: 0.9,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`]);
  };

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
    if (!imageFile) return showError("Please upload an image.");
    setIsLoading(true);
    addLog("Submitting job...");
    try {
      const image_base64 = await fileToBase64(imageFile);
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-fal-comfyui', {
        body: { method: 'submit', input: params, image_base64, mime_type: imageFile.type }
      });
      if (error) throw error;
      setRequestId(data.request_id);
      addLog(`Job submitted successfully. Request ID: ${data.request_id}`);
      showSuccess("Job submitted!");
    } catch (err: any) {
      addLog(`Error submitting job: ${err.message}`);
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStatus = async () => {
    if (!requestId) return showError("Submit a job first to get a Request ID.");
    setIsLoading(true);
    addLog(`Checking status for ${requestId}...`);
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-fal-comfyui', {
        body: { method: 'status', requestId }
      });
      if (error) throw error;
      addLog(`Status: ${JSON.stringify(data, null, 2)}`);
    } catch (err: any) {
      addLog(`Error checking status: ${err.message}`);
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResult = async () => {
    if (!requestId) return showError("Submit a job first to get a Request ID.");
    setIsLoading(true);
    addLog(`Fetching result for ${requestId}...`);
    try {
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-fal-comfyui', {
        body: { method: 'result', requestId }
      });
      if (error) throw error;
      addLog(`Result: ${JSON.stringify(data, null, 2)}`);
      const imageUrl = data?.data?.images?.[0]?.url;
      if (imageUrl) {
        setResultImageUrl(imageUrl);
        showSuccess("Result image loaded!");
      } else {
        showError("Result did not contain an image URL.");
      }
    } catch (err: any) {
      addLog(`Error fetching result: ${err.message}`);
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubscribe = async () => {
    if (!imageFile) return showError("Please upload an image.");
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      addLog("Closed previous log stream.");
    }
    setIsLoading(true);
    setLogs([]);
    setResultImageUrl(null);
    addLog("Submitting job for subscription...");
    try {
      const image_base64 = await fileToBase64(imageFile);
      const { data: submitData, error: submitError } = await supabase.functions.invoke('MIRA-AGENT-proxy-fal-comfyui', {
        body: { method: 'submit', input: params, image_base64, mime_type: imageFile.type }
      });
      if (submitError) throw submitError;
      
      const newRequestId = submitData.request_id;
      setRequestId(newRequestId);
      addLog(`Job submitted. Request ID: ${newRequestId}. Opening log stream...`);

      const streamUrl = `${supabase.supabaseUrl}/functions/v1/MIRA-AGENT-proxy-fal-comfyui-stream?requestId=${newRequestId}&apikey=${SUPABASE_PUBLISHABLE_KEY}`;
      const eventSource = new EventSource(streamUrl);
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        addLog(`[STREAM] Status: ${data.status}, Position: ${data.queue_position || 'N/A'}`);
        if (data.logs) {
          data.logs.forEach((log: any) => addLog(`[WORKER] ${log.message}`));
        }
        if (data.status === "COMPLETED") {
          addLog("Stream complete. Fetching final result...");
          eventSource.close();
          handleResult(); // Automatically fetch result on completion
        }
      };

      eventSource.onerror = (err) => {
        addLog(`Stream error: ${JSON.stringify(err)}`);
        showError("Log stream encountered an error.");
        eventSource.close();
        setIsLoading(false);
      };

    } catch (err: any) {
      addLog(`Error during subscribe: ${err.message}`);
      showError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-full overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">Fal.ai ComfyUI Tester</h1>
        <p className="text-muted-foreground">A developer tool to test the `comfy/research-MIR/test` endpoint.</p>
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
            <CardHeader><CardTitle>2. Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button className="w-full" onClick={handleSubscribe} disabled={isLoading || !imageFile}>
                <Wand2 className="mr-2 h-4 w-4" /> Subscribe (Recommended)
              </Button>
              <p className="text-xs text-muted-foreground text-center">Manual Controls</p>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" onClick={handleSubmit} disabled={isLoading || !imageFile}><Play className="mr-2 h-4 w-4" />Submit</Button>
                <Button variant="outline" onClick={handleStatus} disabled={isLoading || !requestId}><FileClock className="mr-2 h-4 w-4" />Status</Button>
                <Button variant="outline" onClick={handleResult} disabled={isLoading || !requestId}><CheckSquare className="mr-2 h-4 w-4" />Result</Button>
              </div>
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
                {isLoading && <Loader2 className="h-8 w-8 animate-spin" />}
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