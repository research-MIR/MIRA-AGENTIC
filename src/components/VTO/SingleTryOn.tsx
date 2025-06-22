import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { UploadCloud, Wand2, Loader2, Image as ImageIcon, X, PlusCircle, Sparkles, CheckCircle, AlertTriangle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { useQueryClient } from "@tanstack/react-query";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Label } from "@/components/ui/label";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SingleTryOnSettings } from "./SingleTryOnSettings";

interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  source_person_image_url: string;
  source_garment_image_url: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'pro';
}

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear }: { onFileSelect: (file: File) => void, title: string, imageUrl: string | null, onClear: () => void }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files[0]) });

  if (imageUrl) {
    return (
      <div className="relative aspect-square">
        <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
        <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}><X className="h-4 w-4" /></Button>
      </div>
    );
  }

  return (
    <div {...dropzoneProps} className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed p-6 transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
      <div className="text-center pointer-events-none"><UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" /><p className="mt-2 font-semibold">{title}</p></div>
      <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files[0])} />
    </div>
  );
};

const SecureImageDisplay = ({ imageUrl, alt, onClick }: { imageUrl: string | null, alt: string, onClick?: (e: React.MouseEvent<HTMLImageElement>) => void }) => {
    const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
    const hasClickHandler = !!onClick;
  
    if (!imageUrl) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
    if (isLoading) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (error) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
    
    return <img src={displayUrl} alt={alt} className={cn("max-w-full max-h-full object-contain rounded-md", hasClickHandler && "cursor-pointer")} onClick={onClick} />;
};

interface SingleTryOnProps {
    selectedJob: BitStudioJob | undefined;
    resetForm: () => void;
}

export const SingleTryOn = ({ selectedJob, resetForm }: SingleTryOnProps) => {
    const { supabase, session } = useSession();
    const { t } = useLanguage();
    const queryClient = useQueryClient();
    const { showImage } = useImagePreview();

    const [personImageFile, setPersonImageFile] = useState<File | null>(null);
    const [garmentImageFile, setGarmentImageFile] = useState<File | null>(null);
    const [prompt, setPrompt] = useState("");
    const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
    const [isAutoPromptEnabled, setIsAutoPromptEnabled] = useState(true);
    const [promptReady, setPromptReady] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [openAccordion, setOpenAccordion] = useState("item-1");
    const [resolution, setResolution] = useState<'standard' | 'high'>('standard');
    const [numImages, setNumImages] = useState(1);

    const personImageUrl = useMemo(() => personImageFile ? URL.createObjectURL(personImageFile) : null, [personImageFile]);
    const garmentImageUrl = useMemo(() => garmentImageFile ? URL.createObjectURL(garmentImageFile) : null, [garmentImageFile]);

    const uploadFile = async (file: File, type: 'person' | 'garment') => {
        if (!session?.user) throw new Error("User session not found.");
        const optimizedFile = await optimizeImage(file);
        const sanitizedName = sanitizeFilename(optimizedFile.name);
        const filePath = `${session.user.id}/vto-source/${type}-${Date.now()}-${sanitizedName}`;
        
        const { error } = await supabase.storage
          .from('mira-agent-user-uploads')
          .upload(filePath, optimizedFile);
        
        if (error) throw new Error(`Failed to upload ${type} image: ${error.message}`);
        
        const { data: { publicUrl } } = supabase.storage
          .from('mira-agent-user-uploads')
          .getPublicUrl(filePath);
          
        return publicUrl;
    };

    const handleGeneratePrompt = useCallback(async () => {
        if (!personImageFile || !garmentImageFile || !session?.user) {
          return;
        }
        setIsGeneratingPrompt(true);
        setPromptReady(false);
        const toastId = showLoading("Generating detailed prompt...");
        try {
          const person_image_url = await uploadFile(personImageFile, 'person');
          const garment_image_url = await uploadFile(garmentImageFile, 'garment');
    
          const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
            body: { person_image_url, garment_image_url }
          });
    
          if (error) throw error;
          setPrompt(data.final_prompt);
          setPromptReady(true);
          dismissToast(toastId);
          showSuccess("Prompt generated!");
        } catch (err: any) {
          dismissToast(toastId);
          showError(`Failed to generate prompt: ${err.message}`);
        } finally {
          setIsGeneratingPrompt(false);
        }
    }, [personImageFile, garmentImageFile, session, supabase]);

    useEffect(() => {
        if (personImageFile && garmentImageFile && isAutoPromptEnabled) {
          handleGeneratePrompt();
        }
    }, [personImageFile, garmentImageFile, isAutoPromptEnabled, handleGeneratePrompt]);

    const handleTryOn = async () => {
        if (!personImageFile || !garmentImageFile) return showError("Please upload both a person and a garment image.");
        setIsLoading(true);
        const toastId = showLoading("Starting Virtual Try-On job...");
        try {
            const person_image_url = await uploadFile(personImageFile, 'person');
            const garment_image_url = await uploadFile(garmentImageFile, 'garment');
            const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
                body: { 
                  person_image_url, 
                  garment_image_url, 
                  user_id: session?.user?.id, 
                  mode: 'base',
                  prompt: prompt,
                  resolution: resolution,
                  num_images: numImages,
                }
            });
            if (error) throw error;

            dismissToast(toastId);
            showSuccess("Virtual Try-On job started!");
            queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session?.user?.id] });
            setPersonImageFile(null);
            setGarmentImageFile(null);
            setPrompt("");
            setPromptReady(false);
            setResolution('standard');
            setNumImages(1);
        } catch (err: any) {
          dismissToast(toastId);
          showError(err.message);
        } finally {
          setIsLoading(false);
        }
    };

    const renderJobResult = (job: BitStudioJob) => {
        if (job.status === 'failed') return <p className="text-destructive text-sm p-2">Job failed: {job.error_message}</p>;
        if (job.status === 'complete' && job.final_image_url) {
          return <SecureImageDisplay imageUrl={job.final_image_url} alt="Final Result" onClick={() => showImage({ images: [{ url: job.final_image_url! }], currentIndex: 0 })} />;
        }
        return (
          <div className="text-center text-muted-foreground">
            <Loader2 className="h-12 w-12 mx-auto animate-spin" />
            <p className="mt-4">Job status: {job.status}</p>
          </div>
        );
    };

    const isTryOnDisabled = isLoading || !personImageFile || !garmentImageFile || (isAutoPromptEnabled ? !promptReady : !prompt.trim());

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>{selectedJob ? "Selected Job" : "Setup"}</CardTitle>
                    {selectedJob && <Button variant="outline" size="sm" onClick={resetForm}><PlusCircle className="h-4 w-4 mr-2" />New</Button>}
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedJob ? (
                    <div className="grid grid-cols-2 gap-4">
                      <SecureImageDisplay imageUrl={selectedJob.source_person_image_url} alt="Person" onClick={() => showImage({ images: [{ url: selectedJob.source_person_image_url }], currentIndex: 0 })} />
                      <SecureImageDisplay imageUrl={selectedJob.source_garment_image_url} alt="Garment" onClick={() => showImage({ images: [{ url: selectedJob.source_garment_image_url }], currentIndex: 0 })} />
                    </div>
                  ) : (
                    <Accordion type="multiple" defaultValue={['item-1']} className="w-full">
                      <AccordionItem value="item-1">
                        <AccordionTrigger>1. Upload Images</AccordionTrigger>
                        <AccordionContent className="pt-4">
                          <div className="grid grid-cols-2 gap-4">
                            <ImageUploader onFileSelect={setPersonImageFile} title="Person Image" imageUrl={personImageUrl} onClear={() => setPersonImageFile(null)} />
                            <ImageUploader onFileSelect={setGarmentImageFile} title="Garment Image" imageUrl={garmentImageUrl} onClear={() => setGarmentImageFile(null)} />
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="item-2">
                        <AccordionTrigger>2. Prompt</AccordionTrigger>
                        <AccordionContent className="pt-4 space-y-2">
                          <div className="flex items-center space-x-2">
                            <Switch id="auto-prompt" checked={isAutoPromptEnabled} onCheckedChange={setIsAutoPromptEnabled} disabled={!!selectedJob} />
                            <Label htmlFor="auto-prompt" className="text-sm">Auto-Generate</Label>
                          </div>
                          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A detailed prompt will appear here..." rows={4} disabled={isAutoPromptEnabled} />
                          {isGeneratingPrompt && <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating prompt...</div>}
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="item-3">
                        <AccordionTrigger>3. Settings</AccordionTrigger>
                        <AccordionContent className="pt-4">
                          <SingleTryOnSettings
                            resolution={resolution}
                            setResolution={setResolution}
                            numImages={numImages}
                            setNumImages={setNumImages}
                            disabled={!!selectedJob}
                          />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  )}
                </CardContent>
              </Card>
              <Button onClick={handleTryOn} disabled={isTryOnDisabled} className="w-full">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Start Virtual Try-On
              </Button>
            </div>
            <div className="lg:col-span-2">
              <Card className="h-full flex flex-col min-h-[500px]">
                <CardHeader><CardTitle>Result</CardTitle></CardHeader>
                <CardContent className="flex-1 flex items-center justify-center overflow-hidden p-2">
                  {selectedJob ? renderJobResult(selectedJob) : <div className="text-center text-muted-foreground"><ImageIcon className="h-16 w-16 mx-auto mb-4" /><p>Your result will appear here.</p></div>}
                </CardContent>
              </Card>
            </div>
        </div>
    )
}