import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ModelSelector } from "@/components/ModelSelector";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast } from "@/utils/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkles, Wand2, X } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
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
        toastId = showLoading("Stage 1: Generating base image with Google...");
        
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
        if (stage1Error || !stage1Result.images || stage1Result.images.length === 0) throw new Error(`Stage 1 (Google) failed: ${stage1Error?.message || 'No image returned'}`);
        
        const stage1Images = stage1Result.images;
        setIntermediateResult(stage1Images[0]);

        dismissToast(toastId);
        toastId = showLoading("Stage 2: Refining image with Fal.ai...");
        const { data: falResult, error: falError } = await supabase.functions.invoke('MIRA-AGENT-tool-fal-image-to-image', {
          body: { image_urls: [stage1Images[0].publicUrl], prompt: prompt, invoker_user_id: session.user.id }
        });
        if (falError) throw new Error(`Stage 2 (Fal.ai) failed: ${falError.message}`);
        finalImages = falResult.images;
        setResults(finalImages);

      } else {
        // Single Stage Pipeline
        dismissToast(toastId);
        toastId = showLoading(`Generating with Google...`);
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
              </div>
            </CardContent>
          </Card>

          <Card id="generator-settings-card">
            <CardHeader>
              <CardTitle>{t.configureSettings}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <Label htmlFor="two-stage-mode">{t.twoStageRefinement}</Label>
                  <p className="text-[0.8rem] text-muted-foreground">{t.twoStageRefinementDescription}</p>
                </div>
                <Switch id="two-stage-mode" checked={useTwoStage} onCheckedChange={setUseTwoStage} />
              </div>
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