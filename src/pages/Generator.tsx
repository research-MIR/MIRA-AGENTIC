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

interface ImageResult {
  publicUrl: string;
  storagePath: string;
}

interface AspectRatioOption {
    label: string;
    size: string;
}

const modelAspectRatioMap: Record<string, Record<string, AspectRatioOption>> = {
    openai: {
        "1:1": { label: "OpenAI Square (1:1)", size: "1024x1024" },
        "2:3": { label: "OpenAI Portrait (2:3)", size: "1024x1536" },
        "3:2": { label: "OpenAI Landscape (3:2)", size: "1536x1024" },
    },
    google: {
        "1:1": { label: "Google Square (1:1)", size: "1024x1024" },
        "9:16": { label: "Google Portrait (9:16)", size: "768x1408" },
        "16:9": { label: "Google Landscape (16:9)", size: "1408x768" },
        "4:3": { label: "Google Landscape (4:3)", size: "1280x896" },
        "3:4": { label: "Google Portrait (3:4)", size: "896x1280" },
    },
    'fal-ai': {
        "1:1": { label: "Fal Square (1:1)", size: "1024x1024" },
        "9:16": { label: "Fal Portrait (9:16)", size: "768x1408" },
        "16:9": { label: "Fal Landscape (16:9)", size: "1408x768" },
        "4:3": { label: "Fal Landscape (4:3)", size: "1280x896" },
        "3:4": { label: "Fal Portrait (3:4)", size: "896x1280" },
    }
};

const toBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = error => reject(error);
});

const Generator = () => {
  const { supabase, session } = useSession();
  const { showImage } = useImagePreview();
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [numImages, setNumImages] = useState(1);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<ImageResult[]>([]);
  const [intermediateResult, setIntermediateResult] = useState<ImageResult | null>(null);
  const [useTwoStage, setUseTwoStage] = useState(false);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentAspectRatioOptions, setCurrentAspectRatioOptions] = useState(modelAspectRatioMap.openai);

  useEffect(() => {
    const updateAspectRatioOptions = async () => {
        if (!selectedModelId) {
            setCurrentAspectRatioOptions(modelAspectRatioMap.openai);
            return;
        }
        try {
            const { data, error } = await supabase
                .from('mira-agent-models')
                .select('provider')
                .eq('model_id_string', selectedModelId)
                .single();
            if (error) throw error;
            const provider = data.provider.toLowerCase().replace(/\s/g, '-');
            const options = modelAspectRatioMap[provider] || modelAspectRatioMap.openai;
            setCurrentAspectRatioOptions(options);
            
            if (!options[aspectRatio]) {
                setAspectRatio("1:1");
            }
        } catch (error) {
            console.error("Failed to fetch model provider for aspect ratio options:", error);
            setCurrentAspectRatioOptions(modelAspectRatioMap.openai);
        }
    };
    updateAspectRatioOptions();
  }, [selectedModelId, supabase]);

  useEffect(() => {
    if (!useTwoStage && referenceFiles.length > 0) {
      setReferenceFiles([]);
      showError("Reference images cleared. They can only be used with the Two-Stage Refinement pipeline.");
    }
  }, [useTwoStage, referenceFiles.length]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setReferenceFiles(Array.from(e.target.files));
    }
  };

  const removeFile = (fileName: string) => {
    setReferenceFiles(prev => prev.filter(f => f.name !== fileName));
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return showError("Please enter a prompt.");
    if (!session?.user) return showError("You must be logged in to generate images.");

    setIsLoading(true);
    setResults([]);
    setIntermediateResult(null);
    let toastId = showLoading("Warming up the engines...");
    let finalImages: ImageResult[] = [];

    try {
      const isTwoStageWithImage = useTwoStage && referenceFiles.length > 0;
      const selectedSize = currentAspectRatioOptions[aspectRatio as keyof typeof currentAspectRatioOptions]?.size || "1024x1024";

      if (useTwoStage) {
        let stage1Images: ImageResult[];

        if (isTwoStageWithImage) {
          dismissToast(toastId);
          toastId = showLoading("Stage 1: Generating base image with OpenAI...");
          const imagePayloads = await Promise.all(referenceFiles.map(async (file) => ({
            data: await toBase64(file),
            mimeType: file.type,
            name: file.name
          })));
          const { data: openAiResult, error: openAiError } = await supabase.functions.invoke('MIRA-AGENT-tool-openai-image-edit', {
            body: { prompt, images: imagePayloads, n: 1, size: "1024x1024", invoker_user_id: session.user.id }
          });
          if (openAiError || !openAiResult.images || openAiResult.images.length === 0) {
            throw new Error(`Stage 1 (OpenAI) failed: ${openAiError?.message || 'No image returned'}`);
          }
          stage1Images = openAiResult.images;
        } else {
          if (!selectedModelId) throw new Error("Please select a model for the first stage.");
          dismissToast(toastId);
          toastId = showLoading(`Stage 1: Generating base image with ${selectedModelId}...`);
          const { data: modelDetails, error: modelError } = await supabase.from('mira-agent-models').select('provider').eq('model_id_string', selectedModelId).single();
          if (modelError || !modelDetails) throw new Error(`Could not find details for model ${selectedModelId}.`);
          
          const provider = modelDetails.provider.toLowerCase().replace(/\s/g, '-');
          let toolToInvoke = '';
          switch (provider) {
            case 'google': toolToInvoke = 'MIRA-AGENT-tool-generate-image-google'; break;
            case 'fal-ai': toolToInvoke = 'MIRA-AGENT-tool-generate-image-fal'; break;
            case 'openai': toolToInvoke = 'MIRA-AGENT-tool-openai-image-generate'; break;
            default: throw new Error(`Unsupported provider: '${provider}'`);
          }
          
          const { data: stage1Result, error: stage1Error } = await supabase.functions.invoke(toolToInvoke, {
            body: { prompt, number_of_images: 1, model_id: selectedModelId, invoker_user_id: session.user.id, size: selectedSize },
          });
          if (stage1Error || !stage1Result.images || stage1Result.images.length === 0) throw new Error(`Stage 1 (${provider}) failed: ${stage1Error?.message || 'No image returned'}`);
          stage1Images = stage1Result.images;
        }

        setIntermediateResult(stage1Images[0]);

        dismissToast(toastId);
        toastId = showLoading("Stage 2: Refining image with Fal.ai...");
        const { data: falResult, error: falError } = await supabase.functions.invoke('MIRA-AGENT-tool-fal-image-to-image', {
          body: { image_urls: [stage1Images[0].publicUrl], original_prompt: prompt, invoker_user_id: session.user.id }
        });
        if (falError) throw new Error(`Stage 2 (Fal.ai) failed: ${falError.message}`);
        finalImages = falResult.images;
        setResults(finalImages);

      } else {
        if (!selectedModelId) throw new Error("Please select a model for single-stage generation.");
        
        const { data: modelDetails, error: modelError } = await supabase.from('mira-agent-models').select('provider').eq('model_id_string', selectedModelId).single();
        if (modelError || !modelDetails) throw new Error(`Could not find details for model ${selectedModelId}.`);
        
        const provider = modelDetails.provider.toLowerCase().replace(/\s/g, '-');
        let toolToInvoke = '';
        switch (provider) {
          case 'google': toolToInvoke = 'MIRA-AGENT-tool-generate-image-google'; break;
          case 'fal-ai': toolToInvoke = 'MIRA-AGENT-tool-generate-image-fal'; break;
          case 'openai': toolToInvoke = 'MIRA-AGENT-tool-openai-image-generate'; break;
          default: throw new Error(`Unknown or unsupported provider: '${provider}'`);
        }
        
        dismissToast(toastId);
        toastId = showLoading(`Generating with ${provider}...`);

        const { data, error } = await supabase.functions.invoke(toolToInvoke, {
          body: { prompt, negative_prompt: negativePrompt, number_of_images: numImages, seed, model_id: selectedModelId, invoker_user_id: session.user.id, size: selectedSize },
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
            final_result: {
                isImageGeneration: true,
                images: finalImages,
            },
            context: { source: 'direct_generator' }
        };
        const { error: insertError } = await supabase.from('mira-agent-jobs').insert(jobPayload);
        if (insertError) {
            showError(`Images generated, but failed to save to gallery: ${insertError.message}`);
        }
      }

    } catch (err: any) {
      showError(err.message || "An unknown error occurred.");
      console.error("[Generator] Error:", err);
    } finally {
      setIsLoading(false);
      dismissToast(toastId);
    }
  };

  const isTwoStageWithImage = useTwoStage && referenceFiles.length > 0;

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Image Generator</h1>
          <p className="text-muted-foreground">
            Craft your vision directly. Bypass the agent for quick generations.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card id="generator-prompt-card">
            <CardHeader>
              <CardTitle>1. Describe your image</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="prompt">Prompt</Label>
                  <Textarea id="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A photorealistic cat wearing a tiny wizard hat..." rows={6} />
                </div>
                <div>
                  <Label htmlFor="negative-prompt">Negative Prompt (Optional)</Label>
                  <Textarea id="negative-prompt" value={negativePrompt} onChange={(e) => setNegativePrompt(e.target.value)} placeholder="ugly, blurry, watermark, text..." rows={3} />
                </div>
                 <div className={cn(!useTwoStage && "opacity-50")}>
                  <Label htmlFor="reference-images">Reference Image (Two-Stage Only)</Label>
                  <Input id="reference-images" type="file" multiple onChange={handleFileChange} ref={fileInputRef} className="mb-2" disabled={!useTwoStage} />
                  {referenceFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {referenceFiles.map(file => (
                        <div key={file.name} className="relative">
                          <img src={URL.createObjectURL(file)} alt={file.name} className="h-16 w-16 object-cover rounded-md" />
                          <button onClick={() => removeFile(file.name)} className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 h-4 w-4 flex items-center justify-center">
                            <X className="h-2 w-2" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card id="generator-settings-card">
            <CardHeader>
              <CardTitle>2. Configure settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
               <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <Label htmlFor="two-stage-mode">Two-Stage Refinement</Label>
                  <p className="text-[0.8rem] text-muted-foreground">Use the complex text-to-refined-image pipeline.</p>
                </div>
                <Switch id="two-stage-mode" checked={useTwoStage} onCheckedChange={setUseTwoStage} />
              </div>
              <div className={isTwoStageWithImage ? 'opacity-50' : ''}>
                <Label>Model</Label>
                <ModelSelector selectedModelId={selectedModelId} onModelChange={setSelectedModelId} disabled={isTwoStageWithImage} />
              </div>
              <div>
                <Label>Aspect Ratio</Label>
                <Select value={aspectRatio} onValueChange={setAspectRatio} disabled={isTwoStageWithImage}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select aspect ratio..." />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(currentAspectRatioOptions).map(([value, { label }]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="num-images">Images</Label>
                  <Input id="num-images" type="number" value={numImages} onChange={(e) => setNumImages(Math.max(1, parseInt(e.target.value, 10)))} min="1" max="8" disabled={useTwoStage} />
                </div>
                <div>
                  <Label htmlFor="seed">Seed (Optional)</Label>
                  <Input id="seed" type="number" placeholder="Random" onChange={(e) => setSeed(e.target.value ? parseInt(e.target.value, 10) : undefined)} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Button onClick={handleGenerate} disabled={isLoading} className="w-full">
            {isLoading ? <Wand2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            Generate
          </Button>
        </div>

        <div className="lg:col-span-2">
          <Card className="min-h-[60vh]">
            <CardHeader>
              <CardTitle>3. Results</CardTitle>
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
                        <h3 className="font-semibold mb-2 text-center">Stage 1: Base Image</h3>
                        <button onClick={() => showImage({ url: intermediateResult.publicUrl })} className="block w-full h-full">
                            <img
                                src={intermediateResult.publicUrl}
                                alt="Intermediate stage 1 result"
                                className="rounded-lg aspect-square object-cover w-full h-full hover:opacity-80 transition-opacity"
                            />
                        </button>
                    </div>
                    <div>
                        <h3 className="font-semibold mb-2 text-center">Stage 2: Refined Image</h3>
                        <button onClick={() => showImage({ url: results[0].publicUrl })} className="block w-full h-full">
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
                    <button onClick={() => showImage({ url: image.publicUrl })} key={index} className="block w-full h-full">
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
                  <p>Your generated images will appear here.</p>
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