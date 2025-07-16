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
  description: string;
  finalPrompt: string;
  steps: number;
}

const ProductRecontext = () => {
  const { supabase } = useSession();
  const { t } = useLanguage();
  const { showImage } = useImagePreview();

  const [productFiles, setProductFiles] = useState<File[]>([]);
  const [sceneFile, setSceneFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAnalysisMode, setIsAnalysisMode] = useState(false);
  const [stepAmounts, setStepAmounts] = useState("15, 30, 50");

  const productPreviews = useMemo(() => productFiles.map(f => URL.createObjectURL(f)), [productFiles]);
  const scenePreview = useMemo(() => sceneFile ? URL.createObjectURL(sceneFile) : null, [sceneFile]);

  const handleProductFileSelect = (files: FileList | null) => {
    if (!files) return;
    const newFiles = Array.from(files);
    setProductFiles(prev => [...prev, ...newFiles].slice(0, 3));
  };

  const removeProductFile = (index: number) => {
    setProductFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (productFiles.length === 0 || (!prompt && !sceneFile)) {
      showError("Please provide at least one product image and either a scene prompt or a scene reference image.");
      return;
    }
    setIsLoading(true);
    setResult(null);
    setAnalysisResults([]);

    try {
      const product_images_base64 = await Promise.all(productFiles.map(fileToBase64));
      const scene_reference_image_base64 = sceneFile ? await fileToBase64(sceneFile) : null;

      if (isAnalysisMode) {
        const steps = stepAmounts.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n) && n > 0);
        if (steps.length === 0) throw new Error("Please enter valid, comma-separated step amounts for Analysis Mode.");
        
        const toastId = showLoading(`Generating ${steps.length} images...`);
        const promises = steps.map(step => 
          supabase.functions.invoke('MIRA-AGENT-orchestrator-recontext', {
            body: { product_images_base64, user_scene_prompt: prompt, scene_reference_image_base64, sample_step: step }
          }).then(res => ({ ...res, steps: step }))
        );
        
        const results = await Promise.all(promises);
        const successfulResults: AnalysisResult[] = [];
        results.forEach(res => {
          if (res.error) throw res.error;
          successfulResults.push({
            imageUrl: `data:${res.data.mimeType};base64,${res.data.base64Image}`,
            description: res.data.productDescription,
            finalPrompt: res.data.finalPromptUsed,
            steps: res.steps,
          });
        });
        setAnalysisResults(successfulResults);
        dismissToast(toastId);
        showSuccess("Analysis complete!");

      } else {
        const toastId = showLoading("Generating image...");
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-recontext', {
          body: { product_images_base64, user_scene_prompt: prompt, scene_reference_image_base64 }
        });
        if (error) throw error;
        setResult({
          imageUrl: `data:${data.mimeType};base64,${data.base64Image}`,
          description: data.productDescription,
          finalPrompt: data.finalPromptUsed,
          steps: 0 // Not applicable in single mode
        });
        dismissToast(toastId);
      }
    } catch (err: any) {
      showError(`Generation failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('productRecontext')}</h1>
        <p className="text-muted-foreground">{t('productRecontextDescription')}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle>Setup</CardTitle>
            <CardDescription>Provide your product and scene information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('productImage')} (up to 3)</Label>
                <ImageUploader onFileSelect={handleProductFileSelect} title={t('uploadProduct')} multiple />
                {productPreviews.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {productPreviews.map((url, index) => (
                      <div key={index} className="relative">
                        <img src={url} alt={`Product preview ${index + 1}`} className="w-16 h-16 object-cover rounded-md" />
                        <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-5 w-5 rounded-full" onClick={() => removeProductFile(index)}><X className="h-3 w-3" /></Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="scene-prompt">{t('scenePrompt')}</Label>
                <Textarea id="scene-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('scenePromptPlaceholder')} rows={3} />
                <Label className="pt-2 block">{t('sceneReferenceImage')}</Label>
                <ImageUploader onFileSelect={(files) => files && setSceneFile(files[0])} title={t('uploadSceneReference')} imageUrl={scenePreview} onClear={() => setSceneFile(null)} />
              </div>
            </div>
            <div className="space-y-2 p-3 border rounded-md">
              <div className="flex items-center justify-between">
                <Label htmlFor="analysis-mode" className="flex items-center gap-2"><FlaskConical className="h-4 w-4" />{t('analysisMode')}</Label>
                <Switch id="analysis-mode" checked={isAnalysisMode} onCheckedChange={setIsAnalysisMode} />
              </div>
              {isAnalysisMode && (
                <div className="pt-2">
                  <Label htmlFor="step-amounts">{t('stepAmounts')}</Label>
                  <Input id="step-amounts" value={stepAmounts} onChange={(e) => setStepAmounts(e.target.value)} placeholder="e.g., 15, 30, 50" />
                </div>
              )}
            </div>
            <Button className="w-full" onClick={handleGenerate} disabled={isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
              {t('generate')}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('result')}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : isAnalysisMode ? (
              <div className="grid grid-cols-2 gap-4">
                {analysisResults.map((res, index) => (
                  <div key={index} className="space-y-2">
                    <Label className="text-center block">{res.steps} steps</Label>
                    <button
                      className="w-full aspect-square block"
                      onClick={() => showImage({
                        images: analysisResults.map(r => ({ url: r.imageUrl })),
                        currentIndex: index
                      })}
                    >
                      <img src={res.imageUrl} className="max-w-full max-h-full object-contain rounded-md" />
                    </button>
                  </div>
                ))}
              </div>
            ) : result ? (
              <>
                <div className="mt-2 aspect-square w-full bg-muted rounded-md flex items-center justify-center">
                  <button
                    className="w-full h-full"
                    onClick={() => showImage({
                      images: [{ url: result.imageUrl }],
                      currentIndex: 0
                    })}
                  >
                    <img src={result.imageUrl} className="max-w-full max-h-full object-contain" />
                  </button>
                </div>
                <Accordion type="single" collapsible className="w-full mt-2">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>View AI Analysis & Final Prompt</AccordionTrigger>
                    <AccordionContent className="space-y-2">
                      <div>
                        <h4 className="font-semibold text-sm">AI Product Description:</h4>
                        <p className="text-sm p-2 bg-muted rounded-md">{result.description}</p>
                      </div>
                      <div>
                        <h4 className="font-semibold text-sm">Final Prompt Used:</h4>
                        <p className="text-sm p-2 bg-muted rounded-md font-mono">{result.finalPrompt}</p>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </>
            ) : (
              <div className="flex items-center justify-center h-64">
                <p className="text-sm text-muted-foreground">{t('resultPlaceholder')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProductRecontext;