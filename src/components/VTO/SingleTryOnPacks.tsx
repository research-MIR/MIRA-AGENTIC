import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { UploadCloud, Wand2, Loader2, X, Users, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Textarea } from "../ui/textarea";
import { Switch } from "@/components/ui/switch";
import { SingleTryOnSettings } from "./SingleTryOnSettings";
import { ModelPoseSelector } from "./ModelPoseSelector";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { SecureImageDisplay } from "./SecureImageDisplay";
import { BitStudioJob } from "@/types/vto";
import { useVTOJobs } from "@/hooks/useVTOJobs";
import { RecentJobsList } from "./RecentJobsList";
import { useImagePreview } from "@/context/ImagePreviewContext";

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

export const SingleTryOnPacks = () => {
    const { supabase, session } = useSession();
    const { t } = useLanguage();
    const queryClient = useQueryClient();
    const { showImage } = useImagePreview();

    const [selectedPersonUrl, setSelectedPersonUrl] = useState<string | null>(null);
    const [garmentImageFile, setGarmentImageFile] = useState<File | null>(null);
    const [prompt, setPrompt] = useState("");
    const [promptAppendix, setPromptAppendix] = useState("");
    const [isAutoPromptEnabled, setIsAutoPromptEnabled] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [resolution, setResolution] = useState<'standard' | 'high'>('standard');
    const [numImages, setNumImages] = useState(1);
    const [isModelModalOpen, setIsModelModalOpen] = useState(false);
    const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

    const { jobs: recentJobs, isLoading: isLoadingRecent } = useVTOJobs();
    const selectedJob = useMemo(() => recentJobs?.find(job => job.id === selectedJobId), [recentJobs, selectedJobId]);

    const garmentImageUrl = useMemo(() => garmentImageFile ? URL.createObjectURL(garmentImageFile) : null, [garmentImageFile]);

    const uploadFile = async (file: File) => {
        if (!session?.user) throw new Error("User session not found.");
        const optimizedFile = await optimizeImage(file);
        const sanitizedName = sanitizeFilename(optimizedFile.name);
        const filePath = `${session.user.id}/vto-source/garment-${Date.now()}-${sanitizedName}`;
        
        const { error } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, optimizedFile);
        if (error) throw new Error(`Failed to upload garment image: ${error.message}`);
        
        const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
        return publicUrl;
    };

    const handleModelSelect = (url: string) => {
        setSelectedPersonUrl(url);
        setIsModelModalOpen(false);
    };

    const handleTryOn = async () => {
        if (!selectedPersonUrl || !garmentImageFile) return showError("Please select a model and upload a garment image.");
        setIsLoading(true);
        const toastId = showLoading(t('sendingJob'));
        try {
            const garment_image_url = await uploadFile(garmentImageFile);
            
            let finalPrompt = prompt;
            if (isAutoPromptEnabled) {
                const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
                    body: { person_image_url: selectedPersonUrl, garment_image_url }
                });
                if (error) throw error;
                finalPrompt = data.final_prompt;
            }

            const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
                body: { 
                  person_image_url: selectedPersonUrl, 
                  garment_image_url, 
                  user_id: session?.user?.id, 
                  mode: 'base',
                  prompt: finalPrompt,
                  prompt_appendix: promptAppendix,
                  resolution: resolution,
                  num_images: numImages,
                }
            });
            if (error) throw error;

            dismissToast(toastId);
            showSuccess(t('startVirtualTryOn'));
            queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session?.user?.id] });
            setSelectedPersonUrl(null);
            setGarmentImageFile(null);
            setPrompt("");
            setPromptAppendix("");
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

    const isTryOnDisabled = isLoading || !selectedPersonUrl || !garmentImageFile;

    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-1 space-y-4">
                    <Card>
                        <CardHeader><CardTitle>1. Select Model & Garment</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Selected Model</Label>
                                    <div className="aspect-square bg-muted rounded-md flex items-center justify-center">
                                        {selectedPersonUrl ? (
                                            <SecureImageDisplay imageUrl={selectedPersonUrl} alt="Selected Model" />
                                        ) : (
                                            <Users className="h-12 w-12 text-muted-foreground" />
                                        )}
                                    </div>
                                    <Button variant="outline" className="w-full" onClick={() => setIsModelModalOpen(true)}>Select Model</Button>
                                </div>
                                <div className="space-y-2">
                                    <Label>Upload Garment</Label>
                                    <ImageUploader onFileSelect={setGarmentImageFile} title={t('garmentImage')} imageUrl={garmentImageUrl} onClear={() => setGarmentImageFile(null)} />
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>{t('promptSectionTitle')}</CardTitle></CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center space-x-2">
                                <Switch id="auto-prompt" checked={isAutoPromptEnabled} onCheckedChange={setIsAutoPromptEnabled} />
                                <Label htmlFor="auto-prompt" className="text-sm">{t('autoGenerate')}</Label>
                            </div>
                            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t('promptPlaceholderVTO')} rows={4} disabled={isAutoPromptEnabled} />
                            <div>
                                <Label htmlFor="prompt-appendix">{t('promptAppendix')}</Label>
                                <Textarea id="prompt-appendix" value={promptAppendix} onChange={(e) => setPromptAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
                            </div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader><CardTitle>{t('settingsSectionTitle')}</CardTitle></CardHeader>
                        <CardContent>
                            <SingleTryOnSettings
                                resolution={resolution}
                                setResolution={setResolution}
                                numImages={numImages}
                                setNumImages={setNumImages}
                                disabled={false}
                            />
                        </CardContent>
                    </Card>
                    <Button onClick={handleTryOn} disabled={isTryOnDisabled} className="w-full">
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                        {t('startVirtualTryOn')}
                    </Button>
                </div>
                <div className="lg:col-span-2 space-y-4">
                    <Card className="h-full flex flex-col min-h-[500px]">
                        <CardHeader><CardTitle>{t('result')}</CardTitle></CardHeader>
                        <CardContent className="flex-1 flex items-center justify-center overflow-hidden p-2">
                            {selectedJob ? renderJobResult(selectedJob) : (
                                <div className="text-center text-muted-foreground">
                                    <ImageIcon className="h-16 w-16 mx-auto mb-4" />
                                    <p>{t('resultPlaceholder')}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                    <RecentJobsList 
                        jobs={recentJobs}
                        isLoading={isLoadingRecent}
                        selectedJobId={selectedJob?.id || null}
                        onSelectJob={setSelectedJob}
                        mode="base"
                    />
                </div>
            </div>
            <Dialog open={isModelModalOpen} onOpenChange={setIsModelModalOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader><DialogTitle>Select a Model</DialogTitle></DialogHeader>
                    <ModelPoseSelector mode="single" selectedUrls={selectedPersonUrl ? new Set([selectedPersonUrl]) : new Set()} onSelect={handleModelSelect} />
                    <DialogFooter>
                        <Button variant="secondary" onClick={() => setIsModelModalOpen(false)}>Close</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};