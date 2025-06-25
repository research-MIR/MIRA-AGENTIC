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
import { Label } from "@/components/ui/label";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SingleTryOnSettings } from "./SingleTryOnSettings";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { BitStudioJob } from "@/types/vto";

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

const SecureImageDisplay = ({ imageUrl, alt, onClick, className }: { imageUrl: string | null, alt: string, onClick?: (e: React.MouseEvent<HTMLImageElement>) => void, className?: string }) => {
    const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
    const hasClickHandler = !!onClick;
  
    if (!imageUrl) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)}><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
    if (isLoading) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)}><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (error) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)}><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
    
    return <img src={displayUrl} alt={alt} className={cn("max-w-full max-h-full object-contain rounded-md", hasClickHandler && "cursor-pointer", className)} onClick={onClick} />;
};

interface SingleTryOnProps {
    selectedJob: BitStudioJob | undefined;
    resetForm: () => void;
    transferredImageUrl?: string | null;
    onTransferConsumed: () => void;
}

export const SingleTryOn = ({ selectedJob, resetForm, transferredImageUrl, onTransferConsumed }: SingleTryOnProps) => {
    const { supabase, session } = useSession();
    const { t } = useLanguage();
    const queryClient = useQueryClient();
    const { showImage } = useImagePreview();

    const [personImageFile, setPersonImageFile] = useState<File | null>(null);
    const [garmentImageFile, setGarmentImageFile] = useState<File | null>(null);
    const [prompt, setPrompt] = useState("");
    const [promptAppendix, setPromptAppendix] = useState("");
    const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
    const [isAutoPromptEnabled, setIsAutoPromptEnabled] = useState(true);
    const [promptReady, setPromptReady] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [openAccordion, setOpenAccordion] = useState("item-1");
    const [resolution, setResolution] = useState<'standard' | 'high'>('standard');
    const [numImages, setNumImages] = useState(1);

    const personImageUrl = useMemo(() => personImageFile ? URL.createObjectURL(personImageFile) : null, [personImageFile]);
    const garmentImageUrl = useMemo(() => garmentImageFile ? URL.createObjectURL(garmentImageFile) : null, [garmentImageFile]);

    useEffect(() => {
        if (transferredImageUrl) {
          const fetchImageAsFile = async (imageUrl: string) => {
            console.log(`[SingleTryOn] Attempting to fetch transferred image: ${imageUrl}`);
            try {
              const url = new URL(imageUrl);
              const pathSegments = url.pathname.split('/');
              const objectIndex = pathSegments.indexOf('object');
              if (objectIndex === -1 || objectIndex + 2 > pathSegments.length) {
                throw new Error("Invalid Supabase URL format.");
              }
              const bucketName = pathSegments[objectIndex + 2];
              const pathStartIndex = url.pathname.indexOf(bucketName) + bucketName.length + 1;
              const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex));
    
              const { data: blob, error } = await supabase.storage
                .from(bucketName)
                .download(storagePath);
    
              if (error) throw error;
              if (!blob) throw new Error("Downloaded blob is null.");
              console.log('[SingleTryOn] Image blob downloaded successfully from Supabase.');
    
              const filename = imageUrl.split('/').pop() || 'image.png';
              const file = new File([blob], filename, { type: blob.type });
              setPersonImageFile(file);
              console.log('[SingleTryOn] State updated with new person image file. Consuming transfer.');
              onTransferConsumed();
            } catch (e) {
              console.error("Failed to fetch transferred image for VTO:", e);
              showError("Could not load the transferred image.");
            }
          };
          fetchImageAsFile(transferredImageUrl);
        }
      }, [transferredImageUrl, supabase, onTransferConsumed]);

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
        const toastId = showLoading(t('generatingPrompt'));
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
          showSuccess(t('promptReady'));
        } catch (err: any) {
          dismissToast(toastId);
          showError(`Failed to generate prompt: ${err.message}`);
        } finally {
          setIsGeneratingPrompt(false);
        }
    }, [personImageFile, garmentImageFile, session, supabase, t]);

    useEffect(() => {
        if (personImageFile && garmentImageFile && isAutoPromptEnabled) {
          handleGeneratePrompt();
        }
    }, [personImageFile, garmentImageFile, isAutoPromptEnabled, handleGeneratePrompt]);

    const handleTryOn = async () => {
        if (!personImageFile || !garmentImageFile) return showError("Please upload both a person and a garment image.");
        setIsLoading(true);
        const toastId = showLoading(t('sendingJob'));
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
                  prompt_appendix: promptAppendix,
                  resolution: resolution,
                  num_images: numImages,
                }
            });
            if (error) throw error;

            dismissToast(toastId);
            showSuccess(t('startVirtualTryOn'));
            queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session?.user?.id] });
            setPersonImageFile(null);
            setGarmentImageFile(null);
            setPrompt("");
            setPromptAppendix("");
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
        if (job.status === 'failed') return <p className="text-destructive text-sm p-2">{t('jobFailed', { errorMessage: job.error_message })}</p>;
        if (job.status === 'complete' && job.final_image_url) {
          return <SecureImageDisplay imageUrl={job.final_image_url} alt="Final Result" onClick={() => showImage({ images: [{ url: job.final_image_url! }], currentIndex: 0 })} />;
        }
        return (
          <div className="text-center text-muted-foreground">
            <Loader2 className="h-12 w-12 mx-auto animate-spin" />
            <p className="mt-4">{t('jobStatus', { status: job.status })}</p>
          </div>
        );
    };

    const handleClearPersonImage = () => {
        setPersonImageFile(null);
        resetForm();
    };

    const isTryOnDisabled = isLoading || !personImageFile || !garmentImageFile || (isAutoPromptEnabled ? !promptReady : !prompt.trim());

    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 max-w-7xl mx-auto">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>{selectedJob ? t('selectedJob') : t('setup')}</CardTitle>
                    {selectedJob && <Button variant="outline" size="sm" onClick={resetForm}><PlusCircle className="h-4 w-4 mr-2" />{t('new')}</Button>}
                  </div>
                </CardHeader>
                <CardContent>
                  {selectedJob ? (
                    <div className="space-y-4">
                      <p className="text-sm text-muted-foreground">{t('viewingJob')}</p>
                      <div className="grid grid-cols-2 gap-4">
                        <SecureImageDisplay imageUrl={selectedJob.source_person_image_url || null} alt="Person" onClick={() => showImage({ images: [{ url: selectedJob.source_person_image_url! }], currentIndex: 0 })} />
                        <SecureImageDisplay imageUrl={selectedJob.source_garment_image_url || null} alt="Garment" onClick={() => showImage({ images: [{ url: selectedJob.source_garment_image_url! }], currentIndex: 0 })} />
                      </div>
                    </div>
                  ) : (
                    <Accordion type="multiple" defaultValue={['item-1']} className="w-full">
                      <AccordionItem value="item-1">
                        <AccordionTrigger>{t('uploadImages')}</AccordionTrigger>
                        <AccordionContent className="pt-4">
                          <div className="grid grid-cols-2 gap-4">
                            <ImageUploader onFileSelect={setPersonImageFile} title={t('personImage')} imageUrl={personImageUrl} onClear={handleClearPersonImage} />
                            <ImageUploader onFileSelect={setGarmentImageFile} title={t('garmentImage')} imageUrl={garmentImageUrl} onClear={() => setGarmentImageFile(null)} />
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="item-2">
                        <AccordionTrigger>{t('promptSectionTitle')}</AccordionTrigger>
                        <AccordionContent className="pt-4 space-y-4">
                          <div className="flex items-center space-x-2">
                            <Switch id="auto-prompt" checked={isAutoPromptEnabled} onCheckedChange={setIsAutoPromptEnabled} disabled={!!selectedJob} />
                            <Label htmlFor="auto-prompt" className="text-sm">{t('autoGenerate')}</Label>
                          </div>
                          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('promptPlaceholderVTO')} rows={4} disabled={isAutoPromptEnabled} />
                          {isGeneratingPrompt && <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('generatingPrompt')}</div>}
                          <div>
                            <Label htmlFor="prompt-appendix">{t('promptAppendix')}</Label>
                            <Textarea id="prompt-appendix" value={promptAppendix} onChange={(e) => setPromptAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                      <AccordionItem value="item-3">
                        <AccordionTrigger>{t('settingsSectionTitle')}</AccordionTrigger>
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
                {t('startVirtualTryOn')}
              </Button>
            </div>
            <div>
              <Card className="h-full flex flex-col min-h-[500px]">
                <CardHeader><CardTitle>{t('result')}</CardTitle></CardHeader>
                <CardContent className="flex-1 flex items-center justify-center overflow-hidden p-2">
                  {selectedJob ? renderJobResult(selectedJob) : <div className="text-center text-muted-foreground"><ImageIcon className="h-16 w-16 mx-auto mb-4" /><p>{t('resultPlaceholder')}</p></div>}
                </CardContent>
              </Card>
            </div>
        </div>
    )
}