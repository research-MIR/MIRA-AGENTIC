import { useState, useRef, useCallback, useEffect } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, UploadCloud, Play, Check, X, Hourglass } from 'lucide-react';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SecureImageDisplay } from '@/components/VTO/SecureImageDisplay';

interface EnhancorJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  source_image_url: string;
  final_image_url?: string;
  error_message?: string;
  enhancor_mode: string;
  enhancor_params: any;
}

const EnhancorAITester = () => {
  const { supabase, session } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeJobs, setActiveJobs] = useState<EnhancorJob[]>([]);
  const [mode, setMode] = useState<'portrait' | 'general' | 'detailed'>('portrait');
  const [portraitMode, setPortraitMode] = useState<'fast' | 'professional'>('professional');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const addLog = (message: string) => {
    setLogs(prev => [`${new Date().toLocaleTimeString()}: ${message}`, ...prev]);
  };

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery<EnhancorJob[]>({
    queryKey: ['recentEnhancorJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('enhancor_ai_jobs').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  useEffect(() => {
    if (!session?.user?.id) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase.channel(`enhancor-jobs-tracker-${session.user.id}`)
      .on<EnhancorJob>('postgres_changes', { event: '*', schema: 'public', table: 'enhancor_ai_jobs', filter: `user_id=eq.${session.user.id}` },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ['recentEnhancorJobs', session.user.id] });
          setActiveJobs(prev => {
            const updatedJob = payload.new;
            const existingIndex = prev.findIndex(j => j.id === updatedJob.id);
            if (existingIndex > -1) {
              const newJobs = [...prev];
              newJobs[existingIndex] = updatedJob as EnhancorJob;
              return newJobs;
            }
            return prev;
          });
        }
      ).subscribe();
    channelRef.current = channel;

    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [session?.user?.id, supabase, queryClient]);

  const handleFileSelect = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles) return;
    const imageFiles = Array.from(selectedFiles).filter(f => f.type.startsWith('image/'));
    setFiles(imageFiles);
    setPreviews(imageFiles.map(f => URL.createObjectURL(f)));
  }, []);

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => handleFileSelect(e.dataTransfer.files) });

  const handleSubmit = async () => {
    if (files.length === 0 || !session?.user) return showError("Please upload at least one image.");
    setIsLoading(true);
    setLogs([]);
    setActiveJobs([]);
    const toastId = showLoading(`Uploading ${files.length} image(s)...`);

    try {
      const uploadPromises = files.map(async (file) => {
        const filePath = `${session.user.id}/enhancor-sources/${Date.now()}-${file.name}`;
        await supabase.storage.from('mira-agent-user-uploads').upload(filePath, file, { upsert: true });
        const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
        return { publicUrl, file };
      });

      const uploadedImages = await Promise.all(uploadPromises);
      dismissToast(toastId);
      showLoading(`Submitting ${uploadedImages.length} jobs...`);

      const jobPromises = uploadedImages.map(async (image) => {
        const enhancor_params = mode === 'portrait' ? { mode: portraitMode } : {};
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-EnhancorAI', {
          body: { user_id: session.user.id, image_url: image.publicUrl, enhancor_mode: mode, enhancor_params }
        });
        if (error) throw new Error(`Failed to submit job for ${image.file.name}: ${error.message}`);
        return { ...data, source_image_url: image.publicUrl, status: 'queued' };
      });

      const results = await Promise.allSettled(jobPromises);
      const successfulJobs = results.filter(r => r.status === 'fulfilled').map((r: any) => r.value);
      setActiveJobs(successfulJobs);

      dismissToast(toastId);
      showSuccess(`${successfulJobs.length} jobs submitted successfully.`);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-full overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">EnhancorAI Tester</h1>
        <p className="text-muted-foreground">A developer tool to test the EnhancorAI image upscaling service.</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>1. Inputs</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer", isDraggingOver && "border-primary")}>
                {previews.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {previews.map((src, i) => <img key={i} src={src} className="h-20 w-20 object-cover rounded-md" />)}
                  </div>
                ) : <><UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-xs font-medium">Click or drag images</p></>}
                <Input ref={fileInputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files)} />
              </div>
              <div>
                <Label>Enhancor Mode</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">Portrait Upscaler</SelectItem>
                    <SelectItem value="general">General Upscaler</SelectItem>
                    <SelectItem value="detailed">Detailed Upscaler</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {mode === 'portrait' && (
                <div>
                  <Label>Portrait Mode</Label>
                  <Select value={portraitMode} onValueChange={(v) => setPortraitMode(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="professional">Professional</SelectItem>
                      <SelectItem value="fast">Fast</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>2. Action</CardTitle></CardHeader>
            <CardContent>
              <Button onClick={handleSubmit} disabled={isLoading || files.length === 0} className="w-full"><Play className="mr-2 h-4 w-4" />Submit Job(s)</Button>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader><CardTitle>Active Jobs & Results</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-96">
                <div className="space-y-4 pr-4">
                  {activeJobs.length > 0 ? activeJobs.map(job => (
                    <div key={job.id} className="grid grid-cols-2 gap-4 items-center">
                      <SecureImageDisplay imageUrl={job.source_image_url} alt="Source" />
                      <div className="relative aspect-square bg-muted rounded-md flex items-center justify-center">
                        {job.status === 'complete' && job.final_image_url ? (
                          <SecureImageDisplay imageUrl={job.final_image_url} alt="Result" />
                        ) : job.status === 'failed' ? (
                          <div className="text-destructive text-center p-2">
                            <X className="h-8 w-8 mx-auto" />
                            <p className="text-xs mt-2">{job.error_message}</p>
                          </div>
                        ) : (
                          <div className="text-center text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <p className="text-xs mt-2 capitalize">{job.status}...</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )) : <p className="text-sm text-muted-foreground text-center py-8">Submit a job to see results here.</p>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Logs</CardTitle></CardHeader>
            <CardContent>
              <ScrollArea className="h-40 w-full bg-muted rounded-md">
                <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-all">{logs.join('\n')}</pre>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default EnhancorAITester;