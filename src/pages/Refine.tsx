import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadCloud, Wand2 } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useLanguage } from "@/context/LanguageContext";

const sanitizeFilename = (filename: string): string => {
  return filename
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/\.{2,}/g, '.');
};

const Refine = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [prompt, setPrompt] = useState("");
  const [sourceImageFile, setSourceImageFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<{ original: string; refined: string } | null>(null);

  const sourceImageUrl = useMemo(() => {
    if (sourceImageFile) return URL.createObjectURL(sourceImageFile);
    return null;
  }, [sourceImageFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSourceImageFile(file);
      setResult(null);
    }
  };

  const handleRefine = async () => {
    if (!sourceImageFile) return showError("Per favore, carica un'immagine sorgente.");
    if (!prompt.trim()) return showError("Per favore, inserisci un prompt di affinamento.");
    if (!session?.user) return showError("Devi essere loggato per usare questa funzione.");

    setIsLoading(true);
    setResult(null);
    let toastId = showLoading("Caricamento dell'immagine e preparazione dell'ambiente...");

    try {
      const sanitized = sanitizeFilename(sourceImageFile.name);
      const filePath = `${session.user.id}/refine-uploads/${Date.now()}-${sanitized}`;
      
      const { error: uploadError } = await supabase.storage
        .from('mira-agent-user-uploads')
        .upload(filePath, sourceImageFile);

      if (uploadError) throw new Error(`Errore nel caricamento dell'immagine: ${uploadError.message}`);
      
      const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);

      if (!publicUrl) throw new Error("Impossibile ottenere l'URL pubblico per l'immagine caricata.");

      dismissToast(toastId);
      toastId = showLoading("L'AI sta affinando la tua immagine...");

      const { data: refineResult, error: refineError } = await supabase.functions.invoke('MIRA-AGENT-tool-fal-image-to-image', {
        body: {
          image_urls: [publicUrl],
          prompt: prompt,
          invoker_user_id: session.user.id
        }
      });

      if (refineError) throw new Error(`Errore durante l'affinamento: ${refineError.message}`);
      if (!refineResult?.images?.[0]?.publicUrl) throw new Error("Il servizio di affinamento non ha restituito un'immagine valida.");

      setResult({
        original: publicUrl,
        refined: refineResult.images[0].publicUrl
      });

      showSuccess("Immagine affinata con successo!");

    } catch (err: any) {
      showError(err.message);
      console.error("[Refine] Error:", err);
    } finally {
      setIsLoading(false);
      dismissToast(toastId);
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
            <CardContent>
              {isLoading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Skeleton className="aspect-square w-full" />
                  <Skeleton className="aspect-square w-full" />
                </div>
              ) : result ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <h3 className="font-semibold mb-2 text-center">{t.originalImage}</h3>
                    <img src={result.original} alt="Original" className="rounded-lg aspect-square object-contain w-full" />
                  </div>
                  <div>
                    <h3 className="font-semibold mb-2 text-center">{t.refinedImage}</h3>
                    <img src={result.refined} alt="Refined" className="rounded-lg aspect-square object-contain w-full" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-64">
                  <UploadCloud className="h-12 w-12 mb-4" />
                  <p>{t.uploadAnImageToStart}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Refine;