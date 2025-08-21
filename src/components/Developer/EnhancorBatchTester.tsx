import { useState, useCallback, useRef, useEffect } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UploadCloud, X, Download, CheckCircle } from 'lucide-react';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Progress } from '@/components/ui/progress';
import JSZip from 'jszip';
import { RealtimeChannel } from '@supabase/supabase-js';

const UPLOAD_BUCKET = 'enhancor-ai-uploads';

interface BatchJob {
  id: string;
  status: 'processing' | 'complete' | 'failed';
  total_images: number;
  completed_jobs: number;
  results: { original_url: string; general_url: string; detailed_url: string; }[];
}

export const EnhancorBatchTester = () => {
  const { supabase, session } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeBatchJob, setActiveBatchJob] = useState<BatchJob | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if (activeBatchJob?.id) {
      const channel = supabase.channel(`enhancor-batch-${activeBatchJob.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'enhancor_ai_batch_jobs', filter: `id=eq.${activeBatchJob.id}` },
          (payload) => {
            const updatedJob = payload.new as BatchJob;
            setActiveBatchJob(updatedJob);
            if (updatedJob.status === 'complete') {
              showSuccess("Batch processing complete!");
            }
          }
        ).subscribe();
      channelRef.current = channel;
    }
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [activeBatchJob?.id, supabase, queryClient]);

  const handleFileSelect = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    const imageFiles = Array.from(selectedFiles).filter(f => f.type.startsWith('image/'));
    setFiles(prev => [...prev, ...imageFiles]);
    const newPreviews = imageFiles.map(f => URL.createObjectURL(f));
    setPreviews(prev => [...prev, ...newPreviews]);
  }, []);

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => handleFileSelect(e.dataTransfer.files) });

  const handleSubmit = async () => {
    if (files.length === 0 || !session?.user) return showError("Please upload at least one image.");
    setIsLoading(true);
    const toastId = showLoading(`Uploading ${files.length} image(s)...`);
    try {
      const uploadPromises = files.map(async (file) => {
        const filePath = `${session.user.id}/enhancor-sources/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, file, { upsert: true });
        if (error) throw new Error(`Upload failed for ${file.name}: ${error.message}`);
        const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
        return publicUrl;
      });
      const source_image_urls = await Promise.all(uploadPromises);
      dismissToast(toastId);
      showLoading("Starting batch job...");
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-enhancor-batch', {
        body: { user_id: session.user.id, source_image_urls }
      });
      if (error) throw error;
      const { data: batchJob, error: fetchError } = await supabase.from('enhancor_ai_batch_jobs').select('*').eq('id', data.batchJobId).single();
      if (fetchError) throw fetchError;
      setActiveBatchJob(batchJob);
      setFiles([]);
      setPreviews([]);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Process failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!activeBatchJob || activeBatchJob.status !== 'complete') return;
    setIsLoading(true);
    const toastId = showLoading("Preparing ZIP file...");
    try {
      const zip = new JSZip();
      for (const [index, result] of activeBatchJob.results.entries()) {
        const folder = zip.folder(`image_${index + 1}`);
        const [originalRes, generalRes, detailedRes] = await Promise.all([
          fetch(result.original_url),
          fetch(result.general_url),
          fetch(result.detailed_url),
        ]);
        folder?.file('Original.png', await originalRes.blob());
        folder?.file('GeneralUpscaler.png', await generalRes.blob());
        folder?.file('Detailer.png', await detailedRes.blob());
      }
      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `enhancor-batch-${activeBatchJob.id}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      dismissToast(toastId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Download failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const progress = activeBatchJob ? (activeBatchJob.completed_jobs / (activeBatchJob.total_images * 2)) * 100 : 0;

  return (
    <Card>
      <CardHeader><CardTitle>Batch Test Mode</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {!activeBatchJob ? (
          <>
            <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer", isDraggingOver && "border-primary")}>
              <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm font-medium">Click or drag images</p>
              <Input ref={fileInputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files)} />
            </div>
            {previews.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {previews.map((url, index) => (
                  <div key={index} className="relative">
                    <img src={url} alt={`Preview ${index + 1}`} className="w-16 h-16 object-cover rounded-md" />
                    <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-5 w-5 rounded-full" onClick={() => {
                      setFiles(f => f.filter((_, i) => i !== index));
                      setPreviews(p => p.filter((_, i) => i !== index));
                    }}><X className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
            )}
            <Button onClick={handleSubmit} disabled={isLoading || files.length === 0}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Start Batch ({files.length})
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium">Processing Batch...</p>
              {activeBatchJob.status === 'complete' && <CheckCircle className="h-5 w-5 text-green-500" />}
            </div>
            <Progress value={progress} />
            <p className="text-sm text-muted-foreground text-center">{activeBatchJob.completed_jobs} / {activeBatchJob.total_images * 2} jobs complete</p>
            <div className="flex gap-2">
              <Button onClick={handleDownload} disabled={isLoading || activeBatchJob.status !== 'complete'} className="w-full">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                Download Results
              </Button>
              <Button variant="outline" onClick={() => setActiveBatchJob(null)}>Start New Batch</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};