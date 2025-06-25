import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Wand2, Loader2, X, PlusCircle, Shirt, Users, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { useQueryClient } from "@tanstack/react-query";
import { optimizeImage } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { Label } from "@/components/ui/label";
import { InpaintingSettings } from "../Inpainting/InpaintingSettings";

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
};

const MultiImageUploader = ({ onFilesSelect, title, icon, description }: { onFilesSelect: (files: File[]) => void, title: string, icon: React.ReactNode, description: string }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFilesSelect(Array.from(e.dataTransfer.files)) });
  
    return (
      <div {...dropzoneProps} className={cn("flex flex-col h-full justify-center items-center rounded-lg border border-dashed p-2 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        {React.cloneElement(icon as React.ReactElement, { className: "h-6 w-6 text-muted-foreground" })}
        <p className="mt-1 text-xs font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Input ref={inputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e) => e.target.files && onFilesSelect(Array.from(e.target.files))} />
      </div>
    );
};

export const BatchInpaintPro = () => {
    const { supabase, session } = useSession();
    const { t } = useLanguage();
    const queryClient = useQueryClient();

    const [sourceFiles, setSourceFiles] = useState<File[]>([]);
    const [referenceFile, setReferenceFile] = useState<File | null>(null);
    const [prompt, setPrompt] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    
    const [numAttempts, setNumAttempts] = useState(1);
    const [maskExpansion, setMaskExpansion] = useState(3);

    const resetForm = () => {
        setSourceFiles([]);
        setReferenceFile(null);
        setPrompt("");
        setNumAttempts(1);
        setMaskExpansion(3);
    };

    const handleBatchSubmit = async () => {
        if (sourceFiles.length === 0) return showError("Please upload at least one source image.");
        if (!referenceFile) return showError("A reference image is required for auto-masking in batch mode.");
        if (!prompt.trim()) return showError("A prompt is required for batch inpainting.");

        setIsLoading(true);
        const toastId = showLoading(`Queuing ${sourceFiles.length} inpainting jobs...`);

        const jobPromises = sourceFiles.map(async (sourceFile) => {
            try {
                const sourceBase64 = await fileToBase64(sourceFile);
                const referenceBase64 = await fileToBase64(referenceFile!);
                
                const img = new Image();
                await new Promise(resolve => {
                    img.onload = resolve;
                    img.src = URL.createObjectURL(sourceFile);
                });

                const { data: segmentationData, error: segmentationError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-segmentation', {
                    body: {
                        user_id: session?.user.id,
                        image_base64: sourceBase64,
                        mime_type: sourceFile.type,
                        reference_image_base64: referenceBase64,
                        reference_mime_type: referenceFile!.type,
                        image_dimensions: { width: img.width, height: img.height },
                    }
                });
                if (segmentationError) throw new Error(`Auto-masking failed for ${sourceFile.name}: ${segmentationError.message}`);
                
                const payload = {
                    mode: 'inpaint',
                    full_source_image_base64: sourceBase64,
                    mask_image_url: segmentationData.finalMaskUrl,
                    prompt: prompt,
                    is_garment_mode: true,
                    user_id: session?.user.id,
                    num_attempts: numAttempts,
                    mask_expansion_percent: maskExpansion,
                };

                const { error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-inpainting', { body: payload });
                if (proxyError) throw new Error(`Queueing failed for ${sourceFile.name}: ${proxyError.message}`);

            } catch (err) {
                console.error(`Failed to process job for ${sourceFile.name}:`, err);
                return Promise.reject(err);
            }
        });

        const results = await Promise.allSettled(jobPromises);
        const failedCount = results.filter(r => r.status === 'rejected').length;
        
        dismissToast(toastId);
        if (failedCount > 0) {
          showError(`${failedCount} jobs failed to queue. ${sourceFiles.length - failedCount} jobs started successfully.`);
        } else {
          showSuccess(`${sourceFiles.length} jobs started successfully!`);
        }
        
        queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
        queryClient.invalidateQueries({ queryKey: ['inpaintingJobs', session?.user.id] });
        resetForm();
        setIsLoading(false);
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
                <Card>
                    <CardHeader><CardTitle>1. Upload Images</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <MultiImageUploader onFilesSelect={setSourceFiles} title="Source Images" icon={<Users />} description="Upload one or more source images." />
                            <MultiImageUploader onFilesSelect={(files) => setReferenceFile(files[0])} title="Reference Garment" icon={<Shirt />} description="Upload one garment to apply to all." />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>2. Describe the Change</CardTitle></CardHeader>
                    <CardContent>
                        <Label htmlFor="batch-prompt">Prompt</Label>
                        <Textarea id="batch-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g., a red silk dress" rows={3} />
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>3. Settings</CardTitle></CardHeader>
                    <CardContent>
                        <InpaintingSettings
                            numAttempts={numAttempts} setNumAttempts={setNumAttempts}
                            maskExpansion={maskExpansion} setMaskExpansion={setMaskExpansion}
                            disabled={isLoading}
                        />
                    </CardContent>
                </Card>
                <Button size="lg" className="w-full mt-4" onClick={handleBatchSubmit} disabled={isLoading || sourceFiles.length === 0 || !referenceFile || !prompt.trim()}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                    Start Batch Inpaint ({sourceFiles.length})
                </Button>
            </div>
            <div className="lg:col-span-2">
                <Card className="min-h-[75vh]">
                    <CardHeader><CardTitle>Batch Queue</CardTitle></CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <h3 className="font-semibold mb-2">Source Images ({sourceFiles.length})</h3>
                                <ScrollArea className="h-[60vh] border rounded-md p-2">
                                    <div className="grid grid-cols-3 gap-2">
                                        {sourceFiles.map((file, i) => <img key={i} src={URL.createObjectURL(file)} className="w-full h-full object-cover rounded-md aspect-square" />)}
                                    </div>
                                </ScrollArea>
                            </div>
                            <div>
                                <h3 className="font-semibold mb-2">Reference Garment</h3>
                                <div className="aspect-square bg-muted rounded-md flex items-center justify-center">
                                    {referenceFile ? <img src={URL.createObjectURL(referenceFile)} className="w-full h-full object-cover rounded-md" /> : <ImageIcon className="h-12 w-12 text-muted-foreground" />}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};