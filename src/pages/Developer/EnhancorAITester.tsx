import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UploadCloud, AlertTriangle, Image as ImageIcon, PlusCircle, Wand2 } from 'lucide-react';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageCompareModal } from '@/components/ImageCompareModal';
import { RecentJobThumbnail } from '@/components/Jobs/RecentJobThumbnail';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RealtimeChannel } from '@supabase/supabase-js';

const EnhancorAITester = () => {
  const { supabase, session } = useSession();
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [enhancorMode, setEnhancorMode] = useState<'portrait' | 'general' | 'detailed'>('portrait');
  const [portraitMode, setPortraitMode] = useState<'fast' | 'professional'>('professional');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery({
    queryKey: ['recentEnhancorJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from('enhancor_ai_jobs')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => recentJobs?.find(j => j.id === selectedJobId), [recentJobs, selectedJobId]);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase.channel(`enhancor-jobs-tracker-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'enhancor_ai_jobs', filter: `user_id=eq.${session.user.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['recentEnhancorJobs', session.user.id] });
        }
      ).subscribe();
    channelRef.current = channel;

    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [session?.user?.id, supabase, queryClient]);

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
    const toastId = showLoading(`Uploading ${files.length} image(s) and starting job(s)...`);

    try {
      const uploadPromises = files.map(async (file) => {
        const filePath = `${session.user.id}/enhancor-sources/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, file, { upsert: true });
        if (error) throw new Error(`Upload failed for ${file.name}: ${error.message}`);
        const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
        return publicUrl;
      });

      const source_image_urls = await Promise.all(uploadPromises);

      const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-enhancor-ai', {
        body: {
          user_id: session.user.id,
          source_image_urls,
          enhancor_mode: enhancorMode,
          enhancor_params: enhancorMode === 'portrait' ? { mode: portraitMode } : {},
        }
      });

      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess(`${files.length} job(s) started successfully!`);
      setFiles([]);
      setPreviews([]);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Process failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const startNewJob = () => {
    setSelectedJobId(null);
    setFiles([]);
    setPreviews([]);
  };

  return (
    <>
      <div className="p-4 md:p-8 h-full overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">EnhancorAI Upscaler Tester</h1>
          <p className="text-muted-foreground">A developer tool to test the EnhancorAI service.</p>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>{selectedJob ? "Selected Job" : "1. Upload Images"}</CardTitle>
                  {selectedJob && <Button variant="outline" size="sm" onClick={startNewJob}><PlusCircle className="h-4 w-4 mr-2" />New Job</Button>}
                </div>
              </CardHeader>
              <CardContent>
                <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary transition-colors", isDraggingOver && "border-primary bg-primary/10")}>
                  <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
                  <p className="mt-2 text-xs font-medium">Click or drag images (batch supported)</p>
                  <Input ref={fileInputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files)} />
                </div>
                {previews.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {previews.map((url, index) => (
                      <div key={index} className="relative">
                        <img src={url} alt={`Preview ${index + 1}`} className="w-16 h-16 object-cover rounded-md" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>2. Configure</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Enhancer Mode</Label>
                  <Select value={enhancorMode} onValueChange={(v) => setEnhancorMode(v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">Portrait Upscaler</SelectItem>
                      <SelectItem value="general">General Upscaler</SelectItem>
                      <SelectItem value="detailed">Detailed Upscaler</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {enhancorMode === 'portrait' && (
                  <div>
                    <Label>Processing Mode</Label>
                    <Select value={portraitMode} onValueChange={(v) => setPortraitMode(v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fast">Fast</SelectItem>
                        <SelectItem value="professional">Professional</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
            <Button onClick={handleSubmit} disabled={isLoading || files.length === 0}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Enhance {files.length} Image(s)
            </Button>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader><CardTitle>Result</CardTitle></CardHeader>
              <CardContent>
                {selectedJob ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center relative">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">Original</h3>
                        <img src={selectedJob.source_image_url} alt="Original" className="max-w-full max-h-full object-contain" />
                      </div>
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center relative">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">Enhanced</h3>
                        {selectedJob.status === 'complete' && selectedJob.final_image_url ? (
                          <img src={selectedJob.final_image_url} alt="Result" className="max-w-full max-h-full object-contain" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <p className="mt-2 text-sm capitalize">{selectedJob.status}...</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedJob.status === 'complete' && (
                      <Button className="w-full mt-4" onClick={() => setIsCompareModalOpen(true)}>Compare</Button>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <ImageIcon className="h-12 w-12" />
                    <p className="mt-4">Your final image will appear here.</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Recent Jobs</CardTitle></CardHeader>
              <CardContent>
                {isLoadingRecent ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
                  <Carousel opts={{ align: "start" }} className="w-full">
                    <CarouselContent className="-ml-4">
                      {recentJobs.map(job => (
                        <CarouselItem key={job.id} className="pl-4 basis-auto">
                          <RecentJobThumbnail
                            job={job as any}
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
                  <p className="text-sm text-muted-foreground">No recent jobs found.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      {isCompareModalOpen && selectedJob?.source_image_url && selectedJob?.final_image_url && (
        <ImageCompareModal 
          isOpen={isCompareModalOpen}
          onClose={() => setIsCompareModalOpen(false)}
          beforeUrl={selectedJob.source_image_url}
          afterUrl={selectedJob.final_image_url}
        />
      )}
    </>
  );
};

export default EnhancorAITester;