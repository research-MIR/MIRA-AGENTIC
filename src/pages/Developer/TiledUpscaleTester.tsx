import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Image as ImageIcon, Wand2, UploadCloud, X, PlusCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { ImageCompareModal } from "@/components/ImageCompareModal";
import { Slider } from "@/components/ui/slider";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RealtimeChannel } from "@supabase/supabase-js";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BatchJobCard } from '@/components/Developer/BatchJobCard';
import { BatchDetailView } from '@/components/Developer/BatchDetailView';
import { TiledUpscaleJobThumbnail } from '@/components/Developer/TiledUpscaleJobThumbnail';

const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const TiledUpscaleTester = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const [activeTab, setActiveTab] = useState<'single' | 'batch'>('single');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchName, setBatchName] = useState('');
  const [upscaleFactor, setUpscaleFactor] = useState(2.0);
  const [engine, setEngine] = useState('comfyui_tiled_upscaler');
  const [tileSize, setTileSize] = useState<string | number>('default');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sourcePreview = useMemo(() => sourceFile ? URL.createObjectURL(sourceFile) : null, [sourceFile]);
  const batchPreviews = useMemo(() => batchFiles.map(f => URL.createObjectURL(f)), [batchFiles]);

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery({
    queryKey: ['recentTiledUpscaleJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return { batches: [], singles: [] };
      const { data: batches, error: batchError } = await supabase.from('tiled_upscale_batch_jobs').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(10);
      if (batchError) throw batchError;
      const { data: singles, error: singleError } = await supabase.from('mira_agent_tiled_upscale_jobs').select('*').eq('user_id', session.user.id).is('batch_id', null).order('created_at', { ascending: false }).limit(10);
      if (singleError) throw singleError;
      return { batches, singles };
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => {
    if (!selectedJobId) return null;
    const batch = recentJobs?.batches.find(j => j.id === selectedJobId);
    if (batch) return { ...batch, isBatch: true };
    const single = recentJobs?.singles.find(j => j.id === selectedJobId);
    if (single) return { ...single, isBatch: false, name: `Single Job - ${single.id.substring(0,8)}`, total_jobs: 1, completed_jobs: single.status === 'complete' ? 1 : 0 };
    return null;
  }, [recentJobs, selectedJobId]);

  useEffect(() => {
    if (!session?.user?.id) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase.channel(`tiled-upscale-tracker-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mira_agent_tiled_upscale_jobs' }, () => queryClient.invalidateQueries({ queryKey: ['recentTiledUpscaleJobs', session.user.id] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tiled_upscale_batch_jobs' }, () => queryClient.invalidateQueries({ queryKey: ['recentTiledUpscaleJobs', session.user.id] }))
      .subscribe();
    channelRef.current = channel;

    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [session?.user?.id, supabase, queryClient]);

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (activeTab === 'single') {
      setSourceFile(imageFiles[0] || null);
    } else {
      setBatchFiles(prev => [...prev, ...imageFiles]);
    }
  }, [activeTab]);

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => handleFileSelect(e.dataTransfer.files) });

  const handleSubmit = async () => {
    if ((activeTab === 'single' && !sourceFile) || (activeTab === 'batch' && batchFiles.length === 0)) {
      return showError("Please upload at least one image.");
    }
    setIsSubmitting(true);
    const toastId = showLoading("Starting job(s)...");

    try {
      let payload: any = {
        user_id: session?.user?.id,
        upscale_factor: upscaleFactor,
        upscaler_engine: engine,
        tile_size: tileSize === 'default' ? null : tileSize,
      };

      if (activeTab === 'single') {
        const filePath = `${session!.user.id}/tiled-upscale-sources/${Date.now()}-${sourceFile!.name}`;
        const { error: uploadError } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, sourceFile!);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
        payload.source_image_url = publicUrl;
      } else {
        const uploadPromises = batchFiles.map(async (file) => {
          const filePath = `${session!.user.id}/tiled-upscale-sources/${Date.now()}-${file.name}`;
          await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, file);
          return supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath).data.publicUrl;
        });
        payload.source_image_urls = await Promise.all(uploadPromises);
        payload.batch_name = batchName || `Batch - ${new Date().toLocaleString()}`;
      }

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-tiled-upscale', { body: payload });
      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("Job(s) started successfully!");
      setSelectedJobId(data.jobId || data.batchId);
      startNewJob(false); // Don't clear selected job
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Process failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startNewJob = (clearSelection = true) => {
    if (clearSelection) setSelectedJobId(null);
    setSourceFile(null);
    setBatchFiles([]);
    setBatchName('');
  };

  const combinedJobs = useMemo(() => {
    if (!recentJobs) return [];
    const batches = recentJobs.batches || [];
    const singles = (recentJobs.singles || []).map(s => ({
      id: s.id,
      name: `Single Job - ${s.id.substring(0, 8)}`,
      status: s.status,
      total_jobs: 1,
      completed_jobs: s.status === 'complete' ? 1 : 0,
      created_at: s.created_at,
    }));
    return [...batches, ...singles].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [recentJobs]);

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">Tiled Upscale Tester</h1>
          <p className="text-muted-foreground">A developer tool to test the tiled upscaling and compositing pipeline.</p>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>1. Setup</CardTitle>
                  {selectedJobId && <Button variant="outline" size="sm" onClick={() => startNewJob()}><PlusCircle className="h-4 w-4 mr-2" />New Job</Button>}
                </div>
              </CardHeader>
              <CardContent>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="single">Single Image</TabsTrigger>
                    <TabsTrigger value="batch">Batch Process</TabsTrigger>
                  </TabsList>
                  <TabsContent value="single" className="pt-4">
                    <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer", isDraggingOver && "border-primary")}>
                      {sourcePreview ? <img src={sourcePreview} alt="Preview" className="max-h-40 mx-auto rounded-md" /> : <><UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-xs font-medium">Click or drag source image</p></>}
                      <Input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files)} />
                    </div>
                  </TabsContent>
                  <TabsContent value="batch" className="pt-4 space-y-4">
                    <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="Batch Name (Optional)" />
                    <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer", isDraggingOver && "border-primary")}>
                      <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
                      <p className="mt-2 text-xs font-medium">Click or drag images to add to batch</p>
                      <Input ref={fileInputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files)} />
                    </div>
                    {batchPreviews.length > 0 && (
                      <ScrollArea className="h-32">
                        <div className="grid grid-cols-4 gap-2 pr-2">
                          {batchPreviews.map((url, index) => (
                            <div key={index} className="relative aspect-square">
                              <img src={url} alt={`Preview ${index + 1}`} className="w-full h-full object-cover rounded-md" />
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>2. Settings</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Upscale Factor: {upscaleFactor.toFixed(1)}x</Label>
                  <Slider value={[upscaleFactor]} onValueChange={(v) => setUpscaleFactor(v[0])} min={1.1} max={4} step={0.1} />
                </div>
                <div>
                  <Label>Upscaler Engine</Label>
                  <Select value={engine} onValueChange={(v) => setEngine(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="comfyui_tiled_upscaler">ComfyUI (Prompt-based)</SelectItem>
                      <SelectItem value="enhancor_detailed">Enhancor (Detailed)</SelectItem>
                      <SelectItem value="enhancor_general">Enhancor (General)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Tile Size</Label>
                  <Select value={String(tileSize)} onValueChange={(v) => setTileSize(v === 'full_size' || v === 'default' ? v : Number(v))}>
                    <SelectTrigger><SelectValue placeholder="Select tile size..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default (768px)</SelectItem>
                      <SelectItem value="full_size">Full Size (Single Tile)</SelectItem>
                      <SelectItem value="768">768px</SelectItem>
                      <SelectItem value="896">896px</SelectItem>
                      <SelectItem value="1024">1024px</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
            <Button size="lg" className="w-full" onClick={handleSubmit} disabled={isSubmitting || (activeTab === 'single' && !sourceFile) || (activeTab === 'batch' && batchFiles.length === 0)}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Start Job
            </Button>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader><CardTitle>Result</CardTitle></CardHeader>
              <CardContent className="min-h-[400px]">
                {selectedJob?.isBatch ? (
                  <BatchDetailView batchJob={selectedJob} onSelectJob={(jobId) => console.log("Selected individual job:", jobId)} />
                ) : selectedJob ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center relative">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">Original</h3>
                        <SecureImageDisplay imageUrl={selectedJob.source_image_url} alt="Original" />
                      </div>
                      <div className="w-full aspect-square bg-muted rounded-md overflow-hidden flex justify-center items-center relative">
                        <h3 className="font-semibold mb-2 absolute top-2 left-2 bg-background/80 px-2 py-1 rounded-full text-xs">Upscaled</h3>
                        {selectedJob.status === 'complete' && selectedJob.final_image_url ? (
                          <SecureImageDisplay imageUrl={selectedJob.final_image_url} alt="Final Result" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                            <Loader2 className="h-8 w-8 animate-spin" />
                            <p className="mt-2 text-sm capitalize">{selectedJob.status.replace(/_/g, ' ')}...</p>
                          </div>
                        )}
                      </div>
                    </div>
                    {selectedJob.status === 'complete' && <Button className="w-full mt-4" onClick={() => setIsCompareModalOpen(true)}>Compare</Button>}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                    <ImageIcon className="h-16 w-16" />
                    <p className="mt-4">Your result will appear here.</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Recent Batches & Jobs</CardTitle></CardHeader>
              <CardContent>
                {isLoadingRecent ? <Skeleton className="h-48 w-full" /> : combinedJobs.length > 0 ? (
                  <ScrollArea className="h-48">
                    <div className="space-y-2 pr-2">
                      {combinedJobs.map(job => (
                        <BatchJobCard
                          key={job.id}
                          job={job as any}
                          onClick={() => setSelectedJobId(job.id)}
                          isSelected={selectedJobId === job.id}
                        />
                      ))}
                    </div>
                  </ScrollArea>
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

export default TiledUpscaleTester;