import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ModelSelector } from "@/components/ModelSelector";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast } from "@/utils/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Wand2, Info, UploadCloud, X } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLanguage } from "@/context/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface ImageResult {
  publicUrl: string;
  storagePath: string;
}

interface AspectRatioOption {
    label: string;
    size: string;
}

const aspectRatioOptions: Record<string, AspectRatioOption> = {
    "1024x1024": { label: "Square (1:1)", size: "1024x1024" },
    "768x1408": { label: "Portrait (9:16)", size: "768x1408" },
    "1408x768": { label: "Landscape (16:9)", size: "1408x768" },
    "1280x896": { label: "Landscape (4:3)", size: "1280x896" },
    "896x1280": { label: "Portrait (3:4)", size: "896x1280" },
};

const Generator = () => {
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();
  const { t } = useLanguage();
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [numImages, setNumImages] = useState(1);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1024x1024");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [intermediateResult, setIntermediateResult] = useState<ImageResult | null>(null);
  const [useTwoStage, setUseTwoStage] = useState(false);
  
  const [styleReferenceImageFile, setStyleReferenceImageFile] = useState<File | null>(null);
  const [styleReferenceImageUrl, setStyleReferenceImageUrl] = useState<string | null>(null);
  const [garmentReferenceImageFile, setGarmentReferenceImageFile] = useState<File | null>(null);
  const [garmentReferenceImageUrl, setGarmentReferenceImageUrl] = useState<string | null>(null);

  const createChangeHandler = (setFile: (file: File) => void, setUrl: (url: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setFile(file);
      const previewUrl = URL.createObjectURL(file);
      setUrl(previewUrl);
    }
  };

  const createRemoveHandler = (setFile: (file: null) => void, setUrl: (url: null) => void, url: string | null) => () => {
    if (url) {
      URL.revokeObjectURL(url);
    }
    setFile(null);
    setUrl(null);
  };

  const handleStyleReferenceImageChange = createChangeHandler(setStyleReferenceImageFile, setStyleReferenceImageUrl);
  const handleRemoveStyleReferenceImage = createRemoveHandler(setStyleReferenceImageFile, setStyleReferenceImageUrl, styleReferenceImageUrl);
  const handleGarmentReferenceImageChange = createChangeHandler(setGarmentReferenceImageFile, setGarmentReferenceImageUrl);
  const handleRemoveGarmentReferenceImage = createRemoveHandler(setGarmentReferenceImageFile, setGarmentReferenceImageUrl, garmentReferenceImageUrl);

  useEffect(() => {
    return () => {
      if (styleReferenceImageUrl) URL.revokeObjectURL(styleReferenceImageUrl);
      if (garmentReferenceImageUrl) URL.revokeObjectURL(garmentReferenceImageUrl);
    };
  }, [styleReferenceImageUrl, garmentReferenceImageUrl]);

  const handleGenerate = async () => {
    if (!prompt.trim()) return showError("Please enter a prompt.");
    if (!session?.user) return showError("You must be logged in to generate images.");

    setIsLoading(true);
    setResults([]);
    setIntermediateResult(null);
    let toastId = showLoading("Warming up the engines...");
    let finalImages: ImageResult[] = [];

    try {
      if (useTwoStage) {
        dismissToast(toastId);
        toastId = showLoading("Stage 1: Generating base image...");
        
        if (!selectedModelId) throw new Error("Please select a model for the first stage.");
        
        const { data: stage1Result, error: stage1Error } = await supabase.functions.invoke('MIRA-AGENT-tool-generate-image-google', { 
            body: { 
                prompt, 
                number_of_images: 1, 
                model_id: selectedModelId, 
                invoker_user_id: session.user.id,
                size: aspectRatio
            } 
        });
        if (stage1Error || !stage1Result.images || stage1Result.images.length === 0) throw new Error(`Stage 1 failed: ${stage1Error?.message || 'No image returned'}`);
        
        const stage1Images = stage1Result.images;
        setIntermediateResult(stage1Images[0]);

        dismissToast(toastId);
        toastId = showLoading("Stage 2: Refining image...");
        const { data: falResult, error: falError } = await supabase.functions.invoke('MIRA-AGENT-tool-fal-image-to-image', {
          body: { image_urls: [stage1Images[0].publicUrl], prompt: prompt, invoker_user_id: session.user.id }
        });
        if (falError) throw new Error(`Stage 2 failed: ${falError.message}`);
        finalImages = falResult.images;
        setResults(finalImages);

      } else {
        // Single Stage Pipeline
        dismissToast(toastId);
        toastId = showLoading(`Generating images...`);
        if (!selectedModelId) throw new Error("Please select a model.");
        
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-generate-image-google', { 
            body: { 
                prompt, 
                negative_prompt: negativePrompt, 
                number_of_images: numImages, 
                seed, 
                model_id: selectedModelId, 
                invoker_user_id: session.user.id,
                size: aspectRatio
            } 
        });
        if (error) throw error;
        if (!data.images) throw new Error("The generator did not return any images.");
        finalImages = data.images;
        setResults(finalImages);
      }

      if (finalImages.length > 0) {
        const jobPayload = {
            user_id: session.user.id,
            original_prompt: `Direct: ${prompt.slice(0, 40)}...`,
            status: 'complete',
            final_result: { isImageGeneration: true, images: finalImages },
            context: { source: 'direct_generator' }
        };
        const { error: insertError } = await supabase.from('mira-agent-jobs').insert(jobPayload);
        if (insertError) showError(`Images generated, but failed to save to gallery: ${insertError.message}`);
      }

    } catch (err: any) {
      showError(err.message || "An unknown error occurred.");
      console.error("[Generator] Error:", err);
    } finally {
      setIsLoading(false);
      dismissToast(toastId);
    }
  };

  const renderUploader = (label: string, imageUrl: string | null, onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void, onRemove: () => void, inputId: string) => (
    <div>
      <Label>{label}</Label>
      {imageUrl ? (
        <div className="mt-2 relative">
          <img src={imageUrl} alt="Reference" className="w-full h-auto rounded-md object-contain max-h-60" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={onRemove}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex justify-center rounded-lg border border-dashed border-border px-6 py-10">
          <div className="text-center">
            <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
            <div className="mt-4 flex text-sm leading-6 text-muted-foreground">
              <Label htmlFor={inputId} className="relative cursor-pointer rounded-md bg-background font-semibold text-primary focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 hover:text-primary/80">
                <span>Upload a file</span>
                <Input id={inputId} type="file" className="sr-only" onChange={onFileChange} accept="image/*" />
              </Label>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">PNG, JPG, etc.</p>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.imageGenerator}</h1>
          <p className="text-muted-foreground">{t.generatorDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card id="generator-prompt-card">
            <CardHeader>
              <CardTitle>{t.describeYourImage}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="prompt">{t.prompt}</Label>
                  <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t.promptPlaceholderGenerator} rows={6} />
                </div>
                <div>
                  <Label htmlFor="negative-prompt">{t.negativePrompt}</Label>
                  <Textarea id="negative-prompt" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder={t.negativePromptPlaceholder} rows={3} />
                </div>
                {renderUploader(t.styleReference, styleReferenceImageUrl, handleStyleReferenceImageChange, handleRemoveStyleReferenceImage, "style-reference-image-upload")}
                {renderUploader(t.garmentReference, garmentReferenceImageUrl, handleGarmentReferenceImageChange, handleRemoveGarmentReferenceImage, "garment-reference-image-upload")}
              </div>
            </CardContent>
          </Card>

          <Card id="generator-settings-card">
            <CardHeader>
              <CardTitle>{t.configureSettings}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Pro Tip!</AlertTitle>
                  <AlertDescription>
                    {t.refinerSuggestion}
                  </AlertDescription>
                </Alert>
              <div>
                <Label>{t.model}</Label>
                <ModelSelector selectedModelId={selectedModelId} onModelChange={setSelectedModelId} />
              </div>
              <div>
                <Label>{t.aspectRatio}</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select aspect ratio..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(aspectRatioOptions).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="num-images">{t.images}</Label>
                  <Input id="num-images" type="number" value={numImages} onChange={(e) => setNumImages(Math.max(1, parseInt(e.target.value, 10)))} min="1" max="8" disabled={useTwoStage} />
                </div>
                <div>
                  <Label htmlFor="seed">{t.seed}</Label>
                  <Input id="seed" type="number" placeholder="Random" onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value, 10) : undefined)} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleGenerate} disabled={isLoading} className="w-full">
            {isLoading ? <Wand2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {t.generate}
          </Button>
        </div>

        <div className="lg:col-span-2">
          <Card className="min-h-[60vh]">
            <CardHeader>
              <CardTitle>{t.results}</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[...Array(numImages)].map((_, i) => (
                    <Skeleton key={i} className="aspect-square w-full" />
                  ))}
                </div>
              ) : intermediateResult && results.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <h3 className="font-semibold mb-2 text-center">{t.stage1BaseImage}</h3>
                        <button onClick={() => showImage({ images: [{ url: intermediateResult.publicUrl }], currentIndex: 0 })} className="block w-full h-full">
                            <img
                                src={intermediateResult.publicUrl}
                                alt="Intermediate stage 1 result"
                                className="rounded-lg aspect-square object-cover w-full h-full hover:opacity-80 transition-opacity"
                            />
                        </button>
                    </div>
                    <div>
                        <h3 className="font-semibold mb-2 text-center">{t.stage2RefinedImage}</h3>
                        <button onClick={() => showImage({ images: results.map(img => ({ url: img.publicUrl })), currentIndex: 0 })} className="block w-full h-full">
                            <img
                                src={results[0].publicUrl}
                                alt="Final refined stage 2 result"
                                className="rounded-lg aspect-square object-cover w-full h-full hover:opacity-80 transition-opacity"
                            />
                        </button>
                    </div>
                </div>
              ) : results.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {results.map((image, index) => (
                    <button 
                      onClick={() => showImage({ 
                        images: results.map(img => ({ url: img.publicUrl })), 
                        currentIndex: index 
                      })} 
                      key={index} 
                      className="block w-full h-full"
                    >
                      <img
                        src={image.publicUrl}
                        alt={`Generated image ${index + 1}`}
                        className="rounded-lg aspect-square object-cover w-full h-full hover:opacity-80 transition-opacity"
                      />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-64">
                  <Sparkles className="h-12 w-12 mb-4" />
                  <p>{t.resultsPlaceholder}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Generator;