import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Wand2, Loader2, X, Users, Shirt } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useQueryClient } from "@tanstack/react-query";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ModelPoseSelector } from "./ModelPoseSelector";
import { SecureImageDisplay } from "./SecureImageDisplay";
import { Input } from "../ui/input";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";

const MultiImageUploader = ({ onFilesSelect, title, icon }: { onFilesSelect: (files: File[]) => void, title: string, icon: React.ReactNode }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFilesSelect(Array.from(e.dataTransfer.files)) });
  
    return (
      <div {...dropzoneProps} className={cn("flex flex-col h-full justify-center items-center rounded-lg border border-dashed p-2 text-center transition-colors cursor-pointer hover:border-primary", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        {React.cloneElement(icon as React.ReactElement, { className: "h-6 w-6 text-muted-foreground" })}
        <p className="mt-1 text-xs font-semibold">{title}</p>
        <Input ref={inputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e) => e.target.files && onFilesSelect(Array.from(e.target.files))} />
      </div>
    );
};

export const BatchTryOnPacks = () => {
    const { supabase, session } = useSession();
    const { t } = useLanguage();
    const queryClient = useQueryClient();

    const [selectedModelUrls, setSelectedModelUrls] = useState<Set<string>>(new Set());
    const [garmentFiles, setGarmentFiles] = useState<File[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isModelModalOpen, setIsModelModalOpen] = useState(false);

    const uploadFile = async (file: File, type: 'person' | 'garment') => {
        if (!session?.user) throw new Error("User session not found.");
        const optimizedFile = await optimizeImage(file);
        const sanitizedName = sanitizeFilename(optimizedFile.name);
        const filePath = `${session.user.id}/vto-source/${type}-${Date.now()}-${sanitizedName}`;
        
        const { error } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, optimizedFile);
        if (error) throw new Error(`Failed to upload ${type} image: ${error.message}`);
        
        const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
        return publicUrl;
    };

    const handleModelSelect = (url: string) => {
        setSelectedModelUrls(prev => {
            const newSet = new Set(prev);
            if (newSet.has(url)) {
                newSet.delete(url);
            } else {
                newSet.add(url);
            }
            return newSet;
        });
    };

    const handleBatchSubmit = async () => {
        if (selectedModelUrls.size === 0 || garmentFiles.length === 0) {
            return showError("Please select at least one model and one garment.");
        }

        const pairs: { person_url: string, garment_file: File }[] = [];
        selectedModelUrls.forEach(personUrl => {
            garmentFiles.forEach(garmentFile => {
                pairs.push({ person_url: personUrl, garment_file: garmentFile });
            });
        });

        setIsLoading(true);
        const toastId = showLoading(`Queuing ${pairs.length} jobs...`);
        
        const jobPromises = pairs.map(async (pair) => {
            try {
                const garment_image_url = await uploadFile(pair.garment_file, 'garment');
                const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
                    body: { person_image_url: pair.person_url, garment_image_url }
                });
                if (promptError) throw promptError;
                const autoPrompt = promptData.final_prompt;
        
                const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
                    body: { 
                        person_image_url: pair.person_url, 
                        garment_image_url, 
                        user_id: session?.user?.id, 
                        mode: 'base',
                        prompt: autoPrompt,
                    }
                });
                if (error) throw error;
            } catch (err) {
                console.error(`Failed to queue job for model ${pair.person_url} and garment ${pair.garment_file.name}:`, err);
            }
        });

        await Promise.all(jobPromises);
        
        dismissToast(toastId);
        showSuccess(`${pairs.length} jobs started successfully!`);
        
        queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session.user.id] });
        setSelectedModelUrls(new Set());
        setGarmentFiles([]);
        setIsLoading(false);
    };

    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                    <CardHeader><CardTitle>1. Select Models & Garments</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label>Models ({selectedModelUrls.size} selected)</Label>
                            <Button variant="outline" className="w-full mt-1" onClick={() => setIsModelModalOpen(true)}>Select Models from Packs</Button>
                        </div>
                        <div>
                            <Label>Garments ({garmentFiles.length} selected)</Label>
                            <MultiImageUploader onFilesSelect={setGarmentFiles} title="Upload Garments" icon={<Shirt />} />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader><CardTitle>2. Review & Generate</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <h3 className="text-sm font-medium">Selected Models</h3>
                                <ScrollArea className="h-48 border rounded-md p-2">
                                    <div className="grid grid-cols-3 gap-2">
                                        {Array.from(selectedModelUrls).map(url => <SecureImageDisplay key={url} imageUrl={url} alt="Selected Model" />)}
                                    </div>
                                </ScrollArea>
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-sm font-medium">Selected Garments</h3>
                                <ScrollArea className="h-48 border rounded-md p-2">
                                    <div className="grid grid-cols-3 gap-2">
                                        {garmentFiles.map((file, i) => <img key={i} src={URL.createObjectURL(file)} className="w-full h-full object-cover rounded-md aspect-square" />)}
                                    </div>
                                </ScrollArea>
                            </div>
                        </div>
                        <Button size="lg" className="w-full" onClick={handleBatchSubmit} disabled={isLoading || selectedModelUrls.size === 0 || garmentFiles.length === 0}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                            Generate {selectedModelUrls.size * garmentFiles.length} Combinations
                        </Button>
                    </CardContent>
                </Card>
            </div>
            <Dialog open={isModelModalOpen} onOpenChange={setIsModelModalOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader><DialogTitle>Select Models</DialogTitle></DialogHeader>
                    <ModelPoseSelector mode="multiple" selectedUrls={selectedModelUrls} onSelect={handleModelSelect} />
                    <DialogFooter>
                        <Button onClick={() => setIsModelModalOpen(false)}>Done</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
};