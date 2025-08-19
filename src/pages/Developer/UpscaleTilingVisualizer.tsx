import { useState, useRef, useCallback, useEffect } from 'react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, UploadCloud, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import { showError, showLoading, dismissToast } from '@/utils/toast';
import { useDropzone } from '@/hooks/useDropzone';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { RealtimeChannel } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TileDetailModal } from '@/components/Developer/TileDetailModal';
import { SecureImageDisplay } from '@/components/VTO/SecureImageDisplay';

const UpscaleTilingVisualizer = () => {
  const { supabase, session } = useSession();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [selectedTile, setSelectedTile] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: parentJob, isLoading: isLoadingParent } = useQuery({
    queryKey: ['tiledUpscaleJob', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const { data, error } = await supabase.from('mira_agent_tiled_upscale_jobs').select('*').eq('id', jobId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!jobId,
  });

  const { data: tiles, isLoading: isLoadingTiles } = useQuery({
    queryKey: ['tiledUpscaleTiles', jobId],
    queryFn: async () => {
      if (!jobId) return [];
      const { data, error } = await supabase.from('mira_agent_tiled_upscale_tiles').select('*').eq('parent_job_id', jobId).order('tile_index', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!jobId,
  });

  useEffect(() => {
    if (!jobId || !session?.user?.id) return;

    const channel = supabase.channel(`tiled-upscale-job-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mira_agent_tiled_upscale_jobs', filter: `id=eq.${jobId}` },
        () => queryClient.invalidateQueries({ queryKey: ['tiledUpscaleJob', jobId] })
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mira_agent_tiled_upscale_tiles', filter: `parent_job_id=eq.${jobId}` },
        () => queryClient.invalidateQueries({ queryKey: ['tiledUpscaleTiles', jobId] })
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [jobId, supabase, session?.user?.id, queryClient]);

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    setSourceFile(file);
    setJobId(null);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => setSourcePreview(event.target?.result as string);
  }, []);

  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0]) });

  const handleStart = async () => {
    if (!sourceFile || !session?.user) return showError("Please upload a source image first.");
    setIsLoading(true);
    const toastId = showLoading("Uploading image and starting job...");

    try {
      const filePath = `${session.user.id}/tiling-visualizer/${Date.now()}-${sourceFile.name}`;
      await supabase.storage.from('mira-agent-user-uploads').upload(filePath, sourceFile, { upsert: true });
      const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);

      dismissToast(toastId);
      showLoading("Job started. Waiting for tiles...");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-tiled-upscale', {
        body: { source_image_url: publicUrl, user_id: session.user.id }
      });
      if (error) throw error;
      setJobId(data.jobId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Process failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTileClick = (tile: any) => {
    setSelectedTile(tile);
    setIsModalOpen(true);
  };

  return (
    <>
      <div className="p-4 md:p-8 h-full overflow-y-auto">
        <header className="pb-4 mb-8 border-b">
          <h1 className="text-3xl font-bold">Upscale Tiling Visualizer</h1>
          <p className="text-muted-foreground">A developer tool to visualize the image tiling and captioning process.</p>
        </header>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <CardHeader><CardTitle>1. Upload Image</CardTitle></CardHeader>
              <CardContent>
                <div {...dropzoneProps} onClick={() => fileInputRef.current?.click()} className={cn("p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary transition-colors", isDraggingOver && "border-primary bg-primary/10")}>
                  {sourcePreview ? <img src={sourcePreview} alt="Source preview" className="max-h-48 mx-auto rounded-md" /> : <><UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" /><p className="mt-2 text-sm font-medium">Click or drag source image</p></>}
                  <Input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => handleFileSelect(e.target.files?.[0] || null)} />
                </div>
              </CardContent>
            </Card>
            <Button onClick={handleStart} disabled={isLoading || !sourceFile}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageIcon className="mr-2 h-4 w-4" />}
              Start Tiling & Analysis
            </Button>
          </div>
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader><CardTitle>Final Image</CardTitle></CardHeader>
              <CardContent>
                {parentJob?.status === 'complete' && parentJob.final_image_url ? (
                  <SecureImageDisplay imageUrl={parentJob.final_image_url} alt="Final Composite Image" />
                ) : parentJob?.status === 'failed' ? (
                  <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Job Failed</AlertTitle><AlertDescription>{parentJob.error_message}</AlertDescription></Alert>
                ) : jobId ? (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p className="mt-4">Job in progress... Status: {parentJob?.status || 'Starting'}</p>
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
              <CardHeader><CardTitle>Generated Tiles</CardTitle></CardHeader>
              <CardContent>
                {isLoadingTiles ? <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div> : tiles && tiles.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {tiles.map(tile => (
                      <button key={tile.id} onClick={() => handleTileClick(tile)} className="border rounded-md overflow-hidden aspect-square bg-muted hover:border-primary transition-colors">
                        <SecureImageDisplay imageUrl={tile.generated_tile_url} alt={`Tile ${tile.tile_index}`} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">Generated tiles will appear here as they are completed.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <TileDetailModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} tile={selectedTile} />
    </>
  );
};

export default UpscaleTilingVisualizer;