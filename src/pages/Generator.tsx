import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ModelSelector } from "@/components/ModelSelector";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Sparkles, Wand2, UploadCloud, X, GalleryHorizontal } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/context/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

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
  const { t } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [numImages, setNumImages] = useState(1);
  const [seed, setSeed] = useState<number | undefined>(undefined);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1024x1024");
  const [isLoading, setIsLoading] = useState(false);
  const [finalPromptUsed, setFinalPromptUsed] = useState<string | null>(null);
  
  const [styleReferenceImageFile, setStyleReferenceImageFile] = useState<File | null>(null);
  const [styleReferenceImageUrl, setStyleReferenceImageUrl] = useState<string | null>(null);
  const [garmentReferenceImageFiles, setGarmentReferenceImageFiles] = useState<File[]>([]);
  const [garmentReferenceImageUrls, setGarmentReferenceImageUrls] = useState<string[]>([]);
  const [isHelperEnabled, setIsHelperEnabled] = useState(true);

  const garmentInputRef = useRef<HTMLInputElement>(null);
  const styleInputRef = useRef<HTMLInputElement>(null);

  const handleStyleReferenceImageChange = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      if (file.type.startsWith('video/') || file.type === 'image/avif') {
        showError("Unsupported file type. AVIF and video formats are not allowed.");
        return;
      }
      setStyleReferenceImageFile(file);
      setStyleReferenceImageUrl(URL.createObjectURL(file));
    }
  }, []);

  const handleRemoveStyleReferenceImage = () => {
    if (styleReferenceImageUrl) URL.revokeObjectURL(styleReferenceImageUrl);
    setStyleReferenceImageFile(null);
    setStyleReferenceImageUrl(null);
  };

  const handleGarmentImagesChange = useCallback((files: FileList | null) => {
    if (files) {
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];

      Array.from(files).forEach(file => {
        if (file.type.startsWith('video/') || file.type === 'image/avif') {
          invalidFiles.push(file.name);
        } else {
          validFiles.push(file);
        }
      });

      if (invalidFiles.length > 0) {
        showError(`Unsupported file type(s): ${invalidFiles.join(', ')}. AVIF and video formats are not allowed.`);
      }

      if (validFiles.length > 0) {
        setGarmentReferenceImageFiles(prev => [...prev, ...validFiles]);
        const newUrls = validFiles.map(file => URL.createObjectURL(file));
        setGarmentReferenceImageUrls(prev => [...prev, ...newUrls]);
      }
    }
  }, []);

  const handleRemoveGarmentImage = (indexToRemove: number) => {
    URL.revokeObjectURL(garmentReferenceImageUrls[indexToRemove]);
    setGarmentReferenceImageFiles(prev => prev.filter((_, index) => index !== indexToRemove));
    setGarmentReferenceImageUrls(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const { isDraggingOver: isStyleDragging, dropzoneProps: styleDropzoneProps } = useDropzone({ onDrop: handleStyleReferenceImageChange });
  const { isDraggingOver: isGarmentDragging, dropzoneProps: garmentDropzoneProps } = useDropzone({ onDrop: handleGarmentImagesChange });

  useEffect(() => {
    return () => {
      if (styleReferenceImageUrl) URL.revokeObjectURL(styleReferenceImageUrl);
      garmentReferenceImageUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [styleReferenceImageUrl, garmentReferenceImageUrls]);

  const uploadFileAndGetUrl = async (file: File | null, bucket: string): Promise<string | null> => {
    if (!file) return null;
    if (!session?.user) throw new Error("User session not found.");
    const filePath = `${session.user.id}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from(bucket).upload(filePath, file);
    if (uploadError) throw new Error(`Failed to upload file: ${uploadError.message}`);
    const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(filePath);
    return publicUrl;
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return showError("Please enter a prompt.");
    if (!session?.user) return showError("You must be logged in to generate images.");

    setIsLoading(true);
    setFinalPromptUsed(null);
    let toastId = showLoading("Warming up the engines...");
    let promptToUse = prompt;

    try {
      if (isHelperEnabled && (garmentReferenceImageFiles.length > 0 || styleReferenceImageFile)) {
        dismissToast(toastId);
        toastId = showLoading("AI Helper is analyzing your references...");
        
        const garmentUploadPromises = garmentReferenceImageFiles.map(file => uploadFileAndGetUrl(file, 'mira-agent-user-uploads'));
        const garment_image_urls = (await Promise.all(garmentUploadPromises)).filter(url => url !== null) as string[];
        const style_image_url = await uploadFileAndGetUrl(styleReferenceImageFile, 'mira-agent-user-uploads');

        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-direct-generator-prompt-helper', {
          body: { user_prompt: prompt, garment_image_urls, style_image_url }
        });

        if (error) throw error;
        promptToUse = data.final_prompt;
        setFinalPromptUsed(promptToUse);
      } else {
        setFinalPromptUsed(prompt);
      }

      dismissToast(toastId);
      toastId = showLoading(`Queueing generation job...`);
      if (!selectedModelId) throw new Error("Please select a model.");
      
      const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-direct-generator', { 
          body: { 
              prompt: prompt,
              final_prompt_used: promptToUse,
              negative_prompt: negativePrompt, 
              number_of_images: numImages, 
              seed, 
              model_id: selectedModelId, 
              invoker_user_id: session.user.id,
              size: aspectRatio
          } 
      });
      if (error) throw error;
      
      dismissToast(toastId);
      showSuccess("Job queued! Your images will appear in the gallery shortly.");
      queryClient.invalidateQueries({ queryKey: ["jobHistory"] });

    } catch (err: any) {
      showError(err.message || "An unknown error occurred.");
      console.error("[Generator] Error:", err);
    } finally {
      setIsLoading(false);
      dismissToast(toastId);
    }
  };

  const renderGarmentUploader = () => (
    <div {...garmentDropzoneProps}>
      <Label>{t.garmentReference}</Label>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {garmentReferenceImageUrls.map((url, index) => (
          <div key={index} className="relative">
            <img src={url} alt={`Garment ${index + 1}`} className="w-full h-24 object-cover rounded-md" />
            <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => handleRemoveGarmentImage(index)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div 
        className={cn("mt-2 flex justify-center rounded-lg border border-dashed border-border px-6 py-4 transition-colors cursor-pointer", isGarmentDragging && "border-primary bg-primary/10")}
        onClick={() => garmentInputRef.current?.click()}
      >
        <div className="text-center pointer-events-none">
          <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-2 flex text-sm leading-6 text-muted-foreground">
            <span className="relative rounded-md bg-background font-semibold text-primary">
              Upload file(s)
            </span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">or drag and drop</p>
        </div>
      </div>
      <Input 
        ref={garmentInputRef}
        id="garment-reference-image-upload" 
        type="file" 
        className="sr-only" 
        onChange={(e) => handleGarmentImagesChange(e.target.files)} 
        accept="image/*" 
        multiple 
      />
    </div>
  );

  const renderStyleUploader = () => (
    <div {...styleDropzoneProps}>
      <Label>{t.styleReference}</Label>
      {styleReferenceImageUrl ? (
        <div className="mt-2 relative">
          <img src={styleReferenceImageUrl} alt="Reference" className="w-full h-auto rounded-md object-contain max-h-60" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={handleRemoveStyleReferenceImage}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div 
          className={cn("mt-2 flex justify-center rounded-lg border border-dashed border-border px-6 py-10 transition-colors cursor-pointer", isStyleDragging && "border-primary bg-primary/10")}
          onClick={() => styleInputRef.current?.click()}
        >
          <div className="text-center pointer-events-none">
            <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
            <div className="mt-4 flex text-sm leading-6 text-muted-foreground">
              <span className="relative rounded-md bg-background font-semibold text-primary">
                Upload a file
              </span>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">or drag and drop</p>
          </div>
        </div>
      )}
      <Input 
        ref={styleInputRef}
        id="style-reference-image-upload" 
        type="file" 
        className="sr-only" 
        onChange={(e) => handleStyleReferenceImageChange(e.target.files)} 
        accept="image/*" 
      />
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>Reference Images (Optional)</AccordionTrigger>
                    <AccordionContent>
                      <div className="space-y-4 pt-4">
                        {renderGarmentUploader()}
                        {renderStyleUploader()}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
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
                  <Label>AI Prompt Helper</Label>
                  <p className="text-[0.8rem] text-muted-foreground">
                    Automatically enhance your prompt using your reference images.
                  </p>
                </div>
                <Switch
                  checked={isHelperEnabled}
                  onCheckedChange={setIsHelperEnabled}
                />
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
                  <Input id="num-images" type="number" value={numImages} onChange={(e) => setNumImages(Math.max(1, parseInt(e.target.value, 10)))} min="1" max="8" />
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

        <div className="lg:col-span-1">
          <Card className="min-h-[60vh]">
            <CardHeader>
              <CardTitle>{t.results}</CardTitle>
            </CardHeader>
            <CardContent>
              {finalPromptUsed && (
                <div className="mb-4">
                  <Label>Final Prompt Used</Label>
                  <Textarea readOnly value={finalPromptUsed} className="mt-1 h-24 font-mono text-xs" />
                </div>
              )}
              <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-64">
                <Sparkles className="h-12 w-12 mb-4" />
                <p>Your generated images will appear in the gallery.</p>
                <Button variant="outline" className="mt-4" onClick={() => navigate('/gallery')}>
                  <GalleryHorizontal className="mr-2 h-4 w-4" />
                  Go to Gallery
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Generator;