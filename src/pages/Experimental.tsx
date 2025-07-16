import { useState, useRef, useCallback, useMemo } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Wand2, UploadCloud, X, FlaskConical } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { useImagePreview } from "@/context/ImagePreviewContext";

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

interface AnalysisResult {
  imageUrl: string;
  description?: string;
  finalPrompt?: string;
  steps: number;
}

const Experimental = () => {
  const { supabase } = useSession();
  const { t } = useLanguage();
  const { showImage } = useImagePreview();

  // State for VTO
  const [vtoPersonFile, setVtoPersonFile] = useState<File | null>(null);
  const [vtoGarmentFile, setVtoGarmentFile] = useState<File | null>(null);
  const [vtoResult, setVtoResult] = useState<string | null>(null);
  const [isVtoLoading, setIsVtoLoading] = useState(false);
  const [isVtoAnalysisMode, setIsVtoAnalysisMode] = useState(false);
  const [vtoStepAmounts, setVtoStepAmounts] = useState("15, 30, 50");
  const [vtoAnalysisResults, setVtoAnalysisResults] = useState<AnalysisResult[]>([]);

  const vtoPersonPreview = useMemo(() => vtoPersonFile ? URL.createObjectURL(vtoPersonFile) : null, [vtoPersonFile]);
  const vtoGarmentPreview = useMemo(() => vtoGarmentFile ? URL.createObjectURL(vtoGarmentFile) : null, [vtoGarmentFile]);

  const handleVtoGenerate = async () => {
    if (!vtoPersonFile || !vtoGarmentFile) {
      showError("Please provide both a person and a garment image.");
      return;
    }
    setIsVtoLoading(true);
    setVtoResult(null);
    setVtoAnalysisResults([]);

    try {
      const [person_image_base64, garment_image_base64] = await Promise.all([
        fileToBase64(vtoPersonFile),
        fileToBase64(vtoGarmentFile)
      ]);

      if (isVtoAnalysisMode) {
        const steps = vtoStepAmounts.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
        if (steps.length === 0) throw new Error("Please enter valid, comma-separated step amounts for Analysis Mode.");
        
        const toastId = showLoading(`Generating ${steps.length} VTO images...`);
        const promises = steps.map(step => 
          supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
            body: { person_image_base64, garment_image_base64, sample_step: step }
          }).then(res => ({ ...res, steps: step }))
        );
        
        const results = await Promise.all(promises);
        const successfulResults: AnalysisResult[] = [];
        results.forEach(res => {
          if (res.error) throw res.error;
          successfulResults.push({
            imageUrl: `data:${res.data.mimeType};base64,${res.data.base64Image}`,
            steps: res.steps,
          });
        });
        setVtoAnalysisResults(successfulResults);
        dismissToast(toastId);
        showSuccess("VTO Analysis complete!");
      } else {
        const toastId = showLoading("Generating virtual try-on...");
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
          body: { person_image_base64, garment_image_base64 }
        });
        if (error) throw error;
        setVtoResult(`data:${data.mimeType};base64,${data.base64Image}`);
        dismissToast(toastId);
      }
    } catch (err: any) {
      showError(`Generation failed: ${err.message}`);
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
            <div className="space-y-2 p-3 border rounded-md">
              <div className="flex items-center justify-between">
                <Label htmlFor="vto-analysis-mode" className="flex items-center gap-2"><FlaskConical className="h-4 w-4" />{t('analysisMode')}</Label>
                <Switch id="vto-analysis-mode" checked={isVtoAnalysisMode} onCheckedChange={setIsVtoAnalysisMode} />
              </div>
              {isVtoAnalysisMode && (
                <div className="pt-2">
                  <Label htmlFor="vto-step-amounts">{t('stepAmounts')}</Label>
                  <Input id="vto-step-amounts" value={vtoStepAmounts} onChange={(e) => setVtoStepAmounts(e.target.value)} placeholder="e.g., 15, 30, 50" />
                </div>
              )}
            </div>
            <Button className="w-full" onClick={handleVtoGenerate} disabled={isVtoLoading}>
              {isVtoLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {t('generate')}
            </Button>
            <div>
              <Label>{t('result')}</Label>
              <div className="mt-2 w-full bg-muted rounded-md flex items-center justify-center">
                {isVtoLoading ? (
                  <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
                ) : isVtoAnalysisMode ? (
                  <div className="grid grid-cols-2 gap-4 p-4">
                    {vtoAnalysisResults.map((res, index) => (
                      <div key={index} className="space-y-2">
                        <Label className="text-center block">{res.steps} steps</Label>
                        <button
                          className="w-full aspect-square block"
                          onClick={() => showImage({
                            images: vtoAnalysisResults.map(r => ({ url: r.imageUrl })),
                            currentIndex: index
                          })}
                        >
                          <img src={res.imageUrl} className="max-w-full max-h-full object-contain rounded-md" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : vtoResult ? (
                  <div className="aspect-square w-full">
                    <button
                      className="w-full h-full"
                      onClick={() => showImage({
                        images: [{ url: vtoResult }],
                        currentIndex: 0
                      })}
                    >
                      <img src={vtoResult} className="max-w-full max-h-full object-contain" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-64">
                    <p className="text-sm text-muted-foreground">{t('resultPlaceholder')}</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Experimental;