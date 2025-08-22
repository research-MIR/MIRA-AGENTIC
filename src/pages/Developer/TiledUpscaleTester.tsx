import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Image as ImageIcon, Wand2, UploadCloud, X, PlusCircle } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import { ImageCompareModal } from '@/components/ImageCompareModal';
import { Slider } from '@/components/ui/slider';
import { RecentJobThumbnail } from '@/components/Jobs/RecentJobThumbnail';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '@/components/ui/carousel';
import { SecureImageDisplay } from '@/components/VTO/SecureImageDisplay';
import { TileDetailModal } from '@/components/Developer/TileDetailModal';
import { Progress } from '@/components/ui/progress';

const UPLOAD_BUCKET = 'mira-agent-user-uploads';

interface Tile {
  id: string;
  status: string;
  source_tile_bucket: string;
  source_tile_path: string;
  generated_tile_url: string;
  generated_prompt: string;
  tile_index: number;
}

interface TiledUpscaleJob {
  id: string;
  status: string;
  source_image_url: string;
  final_image_url: string | null;
  total_tiles: number;
  metadata?: {
    grid_width?: number;
    upscaler_engine?: string;
  };
  error_message?: string;
}

const TiledUpscaleTester = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [upscaleFactor, setUpscaleFactor] = useState(2.0);
  const [engine, setEngine] = useState('comfyui_tiled_upscaler');
  const [tileSize, setTileSize] = useState<string | number>('default');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const { data: recentJobs, isLoading: isLoadingRecent } = useQuery<TiledUpscaleJob[]>({
    queryKey: ['recentTiledUpscaleJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira_agent_tiled_upscale_jobs').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => recentJobs?.find(j => j.id === selectedJobId), [recentJobs, selectedJobId]);

  const { data: tiles, isLoading: isLoadingTiles } = useQuery<Tile[]>({
    queryKey: ['tiles', selectedJobId],
    queryFn: async () => {
      if (!selectedJobId) return [];
      const { data, error } = await supabase.from('mira_agent_tiled_upscale_tiles').select('*').eq('parent_job_id', selectedJobId).order('tile_index');
      if (error) throw error;
      return data;
    },
    enabled: !!selectedJobId,
  });

  useEffect(() => {
    if (!session?.user?.id) return;
    if (channelRef.current) supabase.removeChannel(channelRef.current);

    const channel = supabase.channel(`tiled-upscale-tracker-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mira_agent_tiled_upscale_jobs', filter: `user_id=eq.${session.user.id}` },
        () => queryClient.invalidateQueries({ queryKey: ['recentTiledUpscaleJobs', session.user.id] })
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mira_agent_tiled_upscale_tiles' },
        (payload: any) => {
          if (payload.new?.parent_job_id === selectedJobId) {
            queryClient.invalidateQueries({ queryKey: ['tiles', selectedJobId] });
          }
        }
      ).subscribe();
    channelRef.current = channel;

    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [session?.user?.id, supabase, queryClient, selectedJobId]);

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    startNewJob();
    setSourceFile(file);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => setSourcePreview(event.target?.result as string);
  }, []);

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0]) });

  const handleSubmit = async () => {
    if (!sourceFile || !session?.user) return showError("Please upload an image.");
    setIsSubmitting(true);
    const toastId = showLoading("Uploading image...");
    try {
      const filePath = `${session.user.id}/tiled-upscale-sources/${Date.now()}-${sourceFile.name}`;
      const { error: uploadError } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, sourceFile, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
      
      dismissToast(toastId);
      showLoading("Starting upscale job...");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-tiled-upscale', {
        body: { 
            user_id: session.user.id, 
            source_image_url: publicUrl, 
            upscale_factor: upscaleFactor, 
            upscaler_engine: engine,
            tile_size: tileSize === 'default' ? null : tileSize
        }
      });
      if (error) throw error;

      dismissToast(toastId);
      showSuccess("Tiled upscale job started!");
      setSelectedJobId(data.jobId);
      setSourceFile(null);
      setSourcePreview(null);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Process failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const startNewJob = () => {
    setSelectedJobId(null);
    setSourceFile(null);
    setSourcePreview(null);
  };

  const progress = selectedJob && selectedJob.total_tiles ? ((tiles?.filter(t => t.status === 'complete').length || 0) / selectedJob.total_tiles) * 100 : 0;
  const gridWidth = selectedJob?.metadata?.grid_width || Math.ceil(Math.sqrt(selectedJob?.total_tiles || 1));

  return (
    <>
      <div className="p-4 md:p-8 h-full overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">Tiled Upscale Tester</h1>
          <p className="text-muted-foreground">A developer tool to test the tiled upscaling and compositing pipeline.</p>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>{selectedJob ? "Selected Job" : "1. Setup"}</CardTitle>
                  {selectedJob && <Button variant="outline" size="sm" onClick={startNewJob}><PlusCircle className="h-4 w-4 mr-2" />New Job</Button>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer", isDraggingOver && "border-primary")}>
                  {sourcePreview ? <img src={sourcePreview} alt="Preview" className="max-h-40 mx-auto rounded-md" /> : <><UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-xs font-medium">Click or drag source image</p></>}
                  <Input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} />
                </div>
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
                  <Select value={String(tileSize)} onValueChange={(v) => setTileSize(v === 'full_size' ? v : Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
            <Button onClick={handleSubmit} disabled={isSubmitting || !sourceFile}>
              {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              Start Tiled Upscale
            </Button>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader><CardTitle>Results</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold mb-2">Original</h3>
                    <div className="aspect-square bg-muted rounded-md flex items-center justify-center">
                      {selectedJob?.source_image_url ? <SecureImageDisplay imageUrl={selectedJob.source_image_url} alt="Original" /> : sourcePreview ? <img src={sourcePreview} alt="Original" className="max-w-full max-h-full object-contain" /> : <ImageIcon />}
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Upscaled</h3>
                    <div className="aspect-square bg-muted rounded-md flex items-center justify-center">
                      {selectedJob?.status === 'complete' && selectedJob.final_image_url ? (
                        <SecureImageDisplay imageUrl={selectedJob.final_image_url} alt="Final Result" />
                      ) : selectedJob ? (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                          <Loader2 className="h-8 w-8 animate-spin" />
                          <p className="text-sm mt-2 capitalize">{selectedJob.status.replace(/_/g, ' ')}...</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                {selectedJob && selectedJob.status !== 'complete' && selectedJob.status !== 'failed' && (
                  <div className="mt-4">
                    <Progress value={progress} />
                    <p className="text-xs text-center mt-1 text-muted-foreground">{tiles?.filter(t => t.status === 'complete').length || 0} / {selectedJob.total_tiles || 0} tiles complete</p>
                  </div>
                )}
                {selectedJob?.status === 'complete' && <Button className="w-full mt-4" onClick={() => setIsCompareModalOpen(true)}>Compare</Button>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Generated Tiles</CardTitle></CardHeader>
              <CardContent>
                <ScrollArea className="h-96">
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${gridWidth}, 1fr)` }}>
                    {isLoadingTiles ? [...Array(gridWidth*gridWidth)].map((_, i) => <Skeleton key={i} className="aspect-square" />) : tiles?.map(tile => (
                      <div key={tile.id} className="aspect-square bg-muted rounded-md cursor-pointer" onClick={() => setSelectedTile(tile)}>
                        {tile.generated_tile_url && <SecureImageDisplay imageUrl={tile.generated_tile_url} alt={`Tile ${tile.tile_index}`} />}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
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
                    <CarouselPrevious className="left-2" />
                    <CarouselNext className="right-2" />
                  </Carousel>
                ) : (
                  <p className="text-sm text-muted-foreground">No recent jobs found.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <TileDetailModal isOpen={!!selectedTile} onClose={() => setSelectedTile(null)} tile={selectedTile} supabase={supabase} />
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