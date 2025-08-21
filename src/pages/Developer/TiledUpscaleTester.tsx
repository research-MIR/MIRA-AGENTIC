import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UploadCloud, Wand2, Image as ImageIcon, X, Grid3x3 } from 'lucide-react';
import { showError, showLoading, dismissToast, showSuccess } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { ImageCompareModal } from '@/components/ImageCompareModal';
import { TileDetailModal } from '@/components/Developer/TileDetailModal';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const UPLOAD_BUCKET = 'mira-agent-user-uploads';

interface Tile {
  id: string;
  status: string;
  source_tile_url: string;
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
  };
  error_message?: string;
}

const TiledUpscaleTester = () => {
  const { supabase, session } = useSession();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [upscaleFactor, setUpscaleFactor] = useState(2.0);
  const [engine, setEngine] = useState('enhancor_detailed');
  const [isLoading, setIsLoading] = useState(false);
  const [activeJob, setActiveJob] = useState<TiledUpscaleJob | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [selectedTile, setSelectedTile] = useState<Tile | null>(null);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    setSourceFile(file);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => setSourcePreview(event.target?.result as string);
  }, []);

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0]),
  });

  useEffect(() => {
    if (channelRef.current) supabase.removeChannel(channelRef.current);
    if (activeJob?.id) {
      const channel = supabase.channel(`tiled-upscale-${activeJob.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'mira_agent_tiled_upscale_jobs', filter: `id=eq.${activeJob.id}` },
          (payload) => {
            setActiveJob(payload.new as TiledUpscaleJob);
            if (payload.new.status === 'complete') showSuccess("Upscale complete!");
            if (payload.new.status === 'failed') showError(`Upscale failed: ${payload.new.error_message}`);
          }
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'mira_agent_tiled_upscale_tiles', filter: `parent_job_id=eq.${activeJob.id}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['tiles', activeJob.id] });
          }
        ).subscribe();
      channelRef.current = channel;
    }
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [activeJob?.id, supabase, queryClient]);

  const { data: fetchedTiles } = useQuery<Tile[]>({
    queryKey: ['tiles', activeJob?.id],
    queryFn: async () => {
      if (!activeJob?.id) return [];
      const { data, error } = await supabase.from('mira_agent_tiled_upscale_tiles').select('*').eq('parent_job_id', activeJob.id).order('tile_index');
      if (error) throw error;
      return data;
    },
    enabled: !!activeJob?.id,
  });

  useEffect(() => {
    if (fetchedTiles) setTiles(fetchedTiles);
  }, [fetchedTiles]);

  const handleSubmit = async () => {
    if (!sourceFile || !session?.user) return showError("Please upload an image.");
    setIsLoading(true);
    const toastId = showLoading("Uploading image...");
    try {
      const filePath = `${session.user.id}/tiled-upscale-sources/${Date.now()}-${sourceFile.name}`;
      const { error: uploadError } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, sourceFile, { upsert: true });
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
      
      dismissToast(toastId);
      showLoading("Starting upscale job...");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-tiled-upscale', {
        body: { user_id: session.user.id, source_image_url: publicUrl, upscale_factor: upscaleFactor, upscaler_engine: engine }
      });
      if (error) throw error;

      const { data: jobData, error: fetchError } = await supabase.from('mira_agent_tiled_upscale_jobs').select('*').eq('id', data.jobId).single();
      if (fetchError) throw fetchError;

      setActiveJob(jobData);
      dismissToast(toastId);
      showSuccess("Tiled upscale job started!");
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Process failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const progress = activeJob && activeJob.total_tiles ? (tiles.filter(t => t.status === 'complete').length / activeJob.total_tiles) * 100 : 0;
  const gridWidth = activeJob?.metadata?.grid_width || Math.ceil(Math.sqrt(activeJob?.total_tiles || 1));

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
              <CardHeader><CardTitle>1. Setup</CardTitle></CardHeader>
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
                  <Select value={engine} onValueChange={setEngine}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="enhancor_detailed">Enhancor (Detailed)</SelectItem>
                      <SelectItem value="enhancor_general">Enhancor (General)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
            <Button onClick={handleSubmit} disabled={isLoading || !sourceFile}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
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
                    {sourcePreview ? <img src={sourcePreview} alt="Original" className="rounded-md w-full" /> : <div className="aspect-square bg-muted rounded-md flex items-center justify-center text-muted-foreground"><ImageIcon /></div>}
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2">Upscaled</h3>
                    <div className="aspect-square bg-muted rounded-md">
                      {activeJob?.status === 'complete' && activeJob.final_image_url ? (
                        <img src={activeJob.final_image_url} alt="Final Result" className="w-full h-full object-contain" />
                      ) : activeJob ? (
                        <div className="w-full h-full flex flex-col items-center justify-center">
                          <Loader2 className="h-8 w-8 animate-spin" />
                          <p className="text-sm mt-2 capitalize">{activeJob.status.replace(/_/g, ' ')}...</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
                {activeJob && activeJob.status !== 'complete' && activeJob.status !== 'failed' && (
                  <div className="mt-4">
                    <Progress value={progress} />
                    <p className="text-xs text-center mt-1 text-muted-foreground">{tiles.filter(t => t.status === 'complete').length} / {activeJob.total_tiles || 0} tiles complete</p>
                  </div>
                )}
                {activeJob?.status === 'complete' && <Button className="w-full mt-4" onClick={() => setIsCompareModalOpen(true)}>Compare</Button>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Generated Tiles</CardTitle></CardHeader>
              <CardContent>
                <ScrollArea className="h-96">
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${gridWidth}, 1fr)` }}>
                    {tiles.map(tile => (
                      <div key={tile.id} className="aspect-square bg-muted rounded-md cursor-pointer" onClick={() => setSelectedTile(tile)}>
                        {tile.generated_tile_url && <img src={tile.generated_tile_url} className="w-full h-full object-cover" />}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <TileDetailModal isOpen={!!selectedTile} onClose={() => setSelectedTile(null)} tile={selectedTile} />
      {isCompareModalOpen && activeJob?.source_image_url && activeJob?.final_image_url && (
        <ImageCompareModal isOpen={isCompareModalOpen} onClose={() => setIsCompareModalOpen(false)} beforeUrl={activeJob.source_image_url} afterUrl={activeJob.final_image_url} />
      )}
    </>
  );
};

export default TiledUpscaleTester;