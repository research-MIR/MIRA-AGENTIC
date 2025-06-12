import { useState, useMemo, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadCloud, Wand2, Loader2 } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/context/LanguageContext";
import { RealtimeChannel } from "@supabase/supabase-js";

const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\.{2,}/g, '.');
};

interface ComfyJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  final_result?: { publicUrl: string };
  error_message?: string;
}

const Refine = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [prompt, setPrompt] = useState("");
  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeJob, setActiveJob] = useState<ComfyJob | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const sourceImageUrl = useMemo(() => {
    if (sourceImageFile) return URL.createObjectURL(sourceImageFile);
    return null;
  }, [sourceImageFile]);

  useEffect(() => {
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [supabase]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSourceImageFile(file);
      setActiveJob(null);
    }
  };

  const handleRefine = async () => {
    if (!sourceImageFile) return showError("Per favore, carica un'immagine sorgente.");
    if (!prompt.trim()) return showError("Per favore, inserisci un prompt di affinamento.");
    if (!session?.user) return showError("Devi essere loggato per usare questa funzione.");

    setIsLoading(true);
    setActiveJob({ id: '', status: 'queued' });
    let toastId = showLoading("Caricamento dell'immagine sorgente...");

    try {
      const uploadFormData = new FormData();
      uploadFormData.append('image', sourceImageFile);
      
      const { data: uploadResult, error: uploadError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui-upload', {
          body: uploadFormData
      });

      if (uploadError) throw new Error(`Caricamento immagine fallito: ${uploadError.message}`);
      const uploadedFilename = uploadResult.name;
      if (!uploadedFilename) throw new Error("ComfyUI non ha restituito un nome file per l'immagine caricata.");
      
      dismissToast(toastId);
      toastId = showLoading("Invio del prompt a ComfyUI...");

      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
        body: {
          prompt_text: prompt,
          image_filename: uploadedFilename,
          invoker_user_id: session.user.id
        }
      });

      if (error) throw error;
      
      const { jobId } = data;
      if (!jobId) throw new Error("Non è stato ricevuto un ID job dal server.");
      
      dismissToast(toastId);
      showSuccess("Job ComfyUI accodato. In attesa del risultato...");
      setActiveJob({ id: jobId, status: 'queued' });

      if (channelRef.current) supabase.removeChannel(channelRef.current);

      channelRef.current = supabase.channel(`comfyui-job-${jobId}`)
        .on<ComfyJob>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'mira-agent-comfyui-jobs', filter: `id=eq.${jobId}` },
          (payload) => {
            setActiveJob(payload.new as ComfyJob);
            if (payload.new.status === 'complete' || payload.new.status === 'failed') {
              supabase.removeChannel(channelRef.current!);
              channelRef.current = null;
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            console.log(`[RefinePage] Successfully subscribed to realtime updates for job ${jobId}!`);
          }
          if (status === 'CHANNEL_ERROR') {
            showError(`Realtime connection failed: ${err?.message}`);
          }
        });

    } catch (err: any) {
      setActiveJob(null);
      showError(`Errore: ${err.message}`);
      console.error("[Refine] Error:", err);
      dismissToast(toastId);
    } finally {
      setIsLoading(false);
    }
  };

  const renderJobStatus = () => {
    if (!activeJob) return null;

    switch (activeJob.status) {
      case 'queued':
        return <div className="flex items-center justify-center h-full"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> In coda...</div>;
      case 'processing':
        return <div className="flex items-center justify-center h-full"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> In elaborazione...</div>;
      case 'complete':
        return activeJob.final_result?.publicUrl ? (
          <img src={activeJob.final_result.publicUrl} alt="Refined by ComfyUI" className="rounded-lg aspect-square object-contain w-full" />
        ) : <p>Job completato, ma nessun URL immagine trovato.</p>;
      case 'failed':
        return <p className="text-destructive">Job fallito: {activeJob.error_message}</p>;
      default:
        return null;
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.refineAndUpscale}</h1>
          <p className="text-muted-foreground">{t.refinePageDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader><CardTitle>{t.sourceImage}</CardTitle></CardHeader>
            <CardContent>
              <Input id="source-image-upload" type="file" accept="image/*" onChange={handleFileChange} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t.refinementPrompt}</CardTitle></CardHeader>
            <CardContent>
              <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t.refinementPromptPlaceholder} rows={6} />
            </CardContent>
          </Card>
          <Button onClick={handleRefine} disabled={isLoading || !sourceImageFile} className="w-full">
            {isLoading ? <Wand2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {t.refineButton}
          </Button>
        </div>

        <div className="lg:col-span-2">
          <Card className="min-h-[60vh]">
            <CardHeader><CardTitle>{t.results}</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <h3 className="font-semibold mb-2 text-center">{t.originalImage}</h3>
                    {sourceImageUrl ? (
                        <img src={sourceImageUrl} alt="Original" className="rounded-lg aspect-square object-contain w-full" />
                    ) : (
                        <div className="aspect-square bg-muted rounded-lg flex flex-col items-center justify-center text-muted-foreground">
                            <UploadCloud className="h-12 w-12 mb-4" />
                            <p>{t.uploadAnImageToStart}</p>
                        </div>
                    )}
                </div>
                 <div>
                    <h3 className="font-semibold mb-2 text-center">{t.refinedImage}</h3>
                    <div className="aspect-square bg-muted rounded-lg flex items-center justify-center">
                        {isLoading && !activeJob ? <Skeleton className="h-full w-full" /> : renderJobStatus()}
                        {!isLoading && !activeJob && <p className="text-muted-foreground text-center p-4">Il risultato apparirà qui.</p>}
                    </div>
                </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Refine;