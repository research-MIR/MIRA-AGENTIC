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

const UpscaleTilingVisualizer = () => {
  const { supabase, session } = useSession();
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreview, setSourcePreview] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [tiles, setTiles] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const handleFileSelect = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    setSourceFile(file);
    setJobId(null);
    setTiles([]);
    setError(null);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      setSourcePreview(event.target?.result as string);
    };
  }, []);

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0]),
  });

  const handleStart = async () => {
    if (!sourceFile || !session?.user) {
      showError("Please upload a source image first.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setTiles([]);
    const toastId = showLoading("Uploading image and starting job...");

    try {
      const filePath = `${session.user.id}/tiling-visualizer/${Date.now()}-${sourceFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from('mira-agent-user-uploads')
        .upload(filePath, sourceFile, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('mira-agent-user-uploads')
        .getPublicUrl(filePath);

      dismissToast(toastId);
      showLoading("Job started. Waiting for tiles...");

      const { data, error: functionError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-tiled-upscale', {
        body: {
          source_image_url: publicUrl,
          user_id: session.user.id,
        }
      });

      if (functionError) throw functionError;
      
      setJobId(data.jobId);
    } catch (err: any) {
      dismissToast(toastId);
      setError(err.message);
      showError(`Process failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!jobId) return;

    const fetchAndSetTiles = async () => {
        const { data, error } = await supabase
            .from('mira_agent_tiled_upscale_tiles')
            .select('*')
            .eq('parent_job_id', jobId)
            .order('tile_index', { ascending: true });
        if (error) {
            showError(error.message);
        } else {
            setTiles(data || []);
        }
    };

    fetchAndSetTiles();

    if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel(`tiled-upscale-job-${jobId}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'mira_agent_tiled_upscale_tiles',
            filter: `parent_job_id=eq.${jobId}`
        }, () => {
            fetchAndSetTiles(); 
        })
        .subscribe();

    channelRef.current = channel;

    return () => {
        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
        }
    };
  }, [jobId, supabase]);

  return (
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
            <CardHeader><CardTitle>Results</CardTitle></CardHeader>
            <CardContent>
              {isLoading && <div className="flex justify-center p-12"><Loader2 className="h-12 w-12 animate-spin text-primary" /></div>}
              {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
              
              {tiles.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {tiles.map(tile => (
                    <div key={tile.id} className="border rounded-md overflow-hidden">
                      <div className="aspect-square bg-muted">
                        <img src={tile.source_tile_url} alt={`Tile ${tile.tile_index}`} className="w-full h-full object-cover" />
                      </div>
                      <div className="p-2 text-xs bg-background">
                        {tile.status === 'analyzing' && <div className="flex items-center text-muted-foreground"><Loader2 className="h-3 w-3 mr-1 animate-spin" />Analyzing...</div>}
                        {tile.status === 'failed' && <p className="text-destructive font-semibold">Failed: {tile.error_message}</p>}
                        {tile.generated_prompt && <p className="text-muted-foreground">{tile.generated_prompt}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                !isLoading && <div className="flex items-center justify-center h-64 text-muted-foreground">Upload an image and start the process to see results.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default UpscaleTilingVisualizer;