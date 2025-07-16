import { useState, useRef, useCallback, useMemo } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Wand2, UploadCloud, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast } from "@/utils/toast";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear, multiple = false }: { onFileSelect: (files: FileList) => void, title: string, imageUrl?: string | null, onClear?: () => void, multiple?: boolean }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files) });
  
    if (imageUrl && onClear) {
      return (
        <div className="relative aspect-square">
          <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}><X className="h-4 w-4" /></Button>
        </div>
      );
    }
  
    return (
      <div {...dropzoneProps} className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        <div className="text-center pointer-events-none"><UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{title}</p></div>
        <Input ref={inputRef} type="file" multiple={multiple} className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files)} />
      </div>
    );
};

const Experimental = () => {
  const { supabase } = useSession();
  const { t } = useLanguage();

  // State for Recontext
  const [recontextProductFiles, setRecontextProductFiles] = useState<File[]>([]);
  const [recontextPrompt, setRecontextPrompt] = useState("");
  const [recontextResult, setRecontextResult] = useState<{ imageUrl: string; description: string; finalPrompt: string; } | null>(null);
  const [isRecontextLoading, setIsRecontextLoading] = useState(false);

  // State for VTO
  const [vtoPersonFile, setVtoPersonFile] = useState<File | null>(null);
  const [vtoGarmentFile, setVtoGarmentFile] = useState<File | null>(null);
  const [vtoResult, setVtoResult] = useState<string | null>(null);
  const [isVtoLoading, setIsVtoLoading] = useState(false);

  const recontextPreviews = useMemo(() => recontextProductFiles.map(f => URL.createObjectURL(f)), [recontextProductFiles]);
  const vtoPersonPreview = useMemo(() => vtoPersonFile ? URL.createObjectURL(vtoPersonFile) : null, [vtoPersonFile]);
  const vtoGarmentPreview = useMemo(() => vtoGarmentFile ? URL.createObjectURL(vtoGarmentFile) : null, [vtoGarmentFile]);

  const handleRecontextFileSelect = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    setRecontextProductFiles(prev => [...prev, ...newFiles].slice(0, 3));
  };

  const removeRecontextFile = (index: number) => {
    setRecontextProductFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleRecontextGenerate = async () => {
    if (recontextProductFiles.length === 0 || !recontextPrompt) {
      showError("Please provide at least one product image and a scene prompt.");
      return;
    }
    setIsRecontextLoading(true);
    setRecontextResult(null);
    const toastId = showLoading("Orchestrating creative prompt...");
    try {
      const product_images_base64 = await Promise.all(recontextProductFiles.map(fileToBase64));
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-recontext', {
        body: { product_images_base64, user_scene_prompt: recontextPrompt }
      });
      if (error) throw error;
      setRecontextResult({
        imageUrl: `data:${data.mimeType};base64,${data.base64Image}`,
        description: data.productDescription,
        finalPrompt: data.finalPromptUsed
      });
      dismissToast(toastId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsRecontextLoading(false);
    }
  };

  const handleVtoGenerate = async () => {
    if (!vtoPersonFile || !vtoGarmentFile) {
      showError("Please provide both a person and a garment image.");
      return;
    }
    setIsVtoLoading(true);
    const toastId = showLoading("Generating virtual try-on...");
    try {
      const [person_image_base64, garment_image_base64] = await Promise.all([
        fileToBase64(vtoPersonFile),
        fileToBase64(vtoGarmentFile)
      ]);
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
        body: { person_image_base64, garment_image_base64 }
      });
      if (error) throw error;
      setVtoResult(`data:${data.mimeType};base64,${data.base64Image}`);
      dismissToast(toastId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsVtoLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('experimentalTools')}</h1>
        <p className="text-muted-foreground">{t('experimentalToolsDescription')}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Product Recontext Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t('productRecontext')}</CardTitle>
            <CardDescription>{t('productRecontextDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('productImage')} (up to 3)</Label>
                <ImageUploader onFileSelect={handleRecontextFileSelect} title={t('uploadProduct')} multiple />
                {recontextPreviews.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {recontextPreviews.map((url, index) => (
                      <div key={index} className="relative">
                        <img src={url} alt={`Product preview ${index + 1}`} className="w-16 h-16 object-cover rounded-md" />
                        <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-5 w-5 rounded-full" onClick={() => removeRecontextFile(index)}><X className="h-3 w-3" /></Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="scene-prompt">{t('scenePrompt')}</Label>
                <Textarea id="scene-prompt" value={recontextPrompt} onChange={(e) => setRecontextPrompt(e.target.value)} placeholder={t('scenePromptPlaceholder')} rows={4} />
              </div>
            </div>
            <Button className="w-full" onClick={handleRecontextGenerate} disabled={isRecontextLoading}>
              {isRecontextLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {t('generate')}
            </Button>
            <div>
              <Label>{t('result')}</Label>
              <div className="mt-2 aspect-square w-full bg-muted rounded-md flex items-center justify-center">
                {isRecontextLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : recontextResult ? <img src={recontextResult.imageUrl} className="max-w-full max-h-full object-contain" /> : <p className="text-sm text-muted-foreground">{t('resultPlaceholder')}</p>}
              </div>
              {recontextResult && (
                <Accordion type="single" collapsible className="w-full mt-2">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>View AI Analysis & Final Prompt</AccordionTrigger>
                    <AccordionContent className="space-y-2">
                      <div>
                        <h4 className="font-semibold text-sm">AI Product Description:</h4>
                        <p className="text-sm p-2 bg-muted rounded-md">{recontextResult.description}</p>
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">Final Prompt Used:</h4>
                        <p className="text-sm p-2 bg-muted rounded-md font-mono">{recontextResult.finalPrompt}</p>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Virtual Try-On Section */}
        <Card>
          <CardHeader>
            <CardTitle>{t('virtualTryOn')}</CardTitle>
            <CardDescription>{t('virtualTryOnDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('personImage')}</Label>
                <ImageUploader onFileSelect={(files) => files && setVtoPersonFile(files[0])} title={t('uploadPerson')} imageUrl={vtoPersonPreview} onClear={() => setVtoPersonFile(null)} />
              </div>
              <div className="space-y-2">
                <Label>{t('garmentImage')}</Label>
                <ImageUploader onFileSelect={(files) => files && setVtoGarmentFile(files[0])} title={t('uploadGarment')} imageUrl={vtoGarmentPreview} onClear={() => setVtoGarmentFile(null)} />
              </div>
            </div>
            <Button className="w-full" onClick={handleVtoGenerate} disabled={isVtoLoading}>
              {isVtoLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {t('generate')}
            </Button>
            <div>
              <Label>{t('result')}</Label>
              <div className="mt-2 aspect-square w-full bg-muted rounded-md flex items-center justify-center">
                {isVtoLoading ? <Loader2 className="h-8 w-8 animate-spin" /> : vtoResult ? <img src={vtoResult} className="max-w-full max-h-full object-contain" /> : <p className="text-sm text-muted-foreground">{t('resultPlaceholder')}</p>}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Experimental;