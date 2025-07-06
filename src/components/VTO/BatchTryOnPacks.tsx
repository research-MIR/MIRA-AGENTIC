import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Wand2, Loader2, X, PlusCircle, Shirt, Users, Link2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { useQueryClient } from "@tanstack/react-query";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "../ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ModelPoseSelector } from "./ModelPoseSelector";
import { SecureImageDisplay } from "./SecureImageDisplay";

const MultiImageUploader = ({ onFilesSelect, title, icon, description }: { onFilesSelect: (files: File[]) => void, title: string, icon: React.ReactNode, description: string }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFilesSelect(Array.from(e.dataTransfer.files)) });
  
    return (
      <div {...dropzoneProps} className={cn("flex flex-col h-full justify-center items-center rounded-lg border border-dashed p-2 text-center transition-colors cursor-pointer hover:border-primary", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        {React.cloneElement(icon as React.ReactElement, { className: "h-6 w-6 text-muted-foreground" })}
        <p className="mt-1 text-xs font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Input ref={inputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e) => e.target.files && onFilesSelect(Array.from(e.target.files))} />
      </div>
    );
};

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
      <div {...dropzoneProps} className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        <div className="text-center pointer-events-none"><PlusCircle className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{title}</p></div>
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files[0])} />
      </div>
    );
};

export const BatchTryOnPacks = () => {
    const { supabase, session } = useSession();
    const { t } = useLanguage();
    const queryClient = useQueryClient();

    const [batchMode, setBatchMode] = useState('one-garment');
    const [batchGarmentFile, setBatchGarmentFile] = useState<File | null>(null);
    const [batchPersonFiles, setBatchPersonFiles] = useState<File[]>([]);
    const [batchRandomGarmentFiles, setBatchRandomGarmentFiles] = useState<File[]>([]);
    const [batchRandomPersonFiles, setBatchRandomPersonFiles] = useState<File[]>([]);
    const [precisePairs, setPrecisePairs] = useState<{ person: File, garment: File, appendix: string }[]>([]);
    const [tempPairPerson, setTempPairPerson] = useState<File | null>(null);
    const [tempPairGarment, setTempPairGarment] = useState<File | null>(null);
    const [tempPairAppendix, setTempPairAppendix] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [generalAppendix, setGeneralAppendix] = useState("");
    const [isModelModalOpen, setIsModelModalOpen] = useState(false);
    const [selectedModelUrls, setSelectedModelUrls] = useState<Set<string>>(new Set());

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

    const resetBatchForm = () => {
        setBatchGarmentFile(null);
        setBatchPersonFiles([]);
        setBatchRandomGarmentFiles([]);
        setBatchRandomPersonFiles([]);
        setPrecisePairs([]);
        setGeneralAppendix("");
    };

    const handleBatchSubmit = async () => {
        let pairs: { person_url: string, garment_file: File, appendix?: string }[] = [];
        if (batchMode === 'one-garment') {
          if (selectedModelUrls.size === 0 || !batchGarmentFile) return showError("Please select models and provide one garment image.");
          pairs = Array.from(selectedModelUrls).map(personUrl => ({ person_url: personUrl, garment_file: batchGarmentFile, appendix: generalAppendix }));
        } else if (batchMode === 'random') {
          if (selectedModelUrls.size === 0 || batchRandomGarmentFiles.length === 0) return showError("Please select models and provide at least one garment image for random pairing.");
          const shuffledPeople = Array.from(selectedModelUrls).sort(() => 0.5 - Math.random());
          const shuffledGarments = [...batchRandomGarmentFiles].sort(() => 0.5 - Math.random());
          const numPairs = Math.min(shuffledPeople.length, shuffledGarments.length);
          for (let i = 0; i < numPairs; i++) {
            pairs.push({ person_url: shuffledPeople[i], garment_file: shuffledGarments[i], appendix: generalAppendix });
          }
        } else if (batchMode === 'precise') {
          if (precisePairs.length === 0) return showError("Please add at least one precise pair.");
          // This mode doesn't use the model selector, it uses file uploads per pair
          // This part needs to be handled differently if we want to use selected models
        }
    
        if (pairs.length === 0) return showError("No valid pairs to process.");
    
        setIsLoading(true);
        const toastId = showLoading(`Queuing ${pairs.length} jobs...`);
        
        const jobPromises = pairs.map(async (pair) => {
            const garment_image_url = await uploadFile(pair.garment_file, 'garment');
            
            const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
                body: { person_image_url: pair.person_url, garment_image_url, prompt_appendix: pair.appendix }
            });
            if (promptError) throw promptError;
            const autoPrompt = promptData.final_prompt;
    
            const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
                body: { 
                    person_image_url: pair.person_url, 
                    garment_image_url, 
                    user_id: session?.user?.id, 
                    mode: 'base',
                    prompt: autoPrompt
                }
            });
            if (error) throw error;
        });

        const results = await Promise.allSettled(jobPromises);
        const failedCount = results.filter(r => r.status === 'rejected').length;
        
        dismissToast(toastId);
        if (failedCount > 0) {
          showError(`${failedCount} jobs failed to queue. ${pairs.length - failedCount} jobs started successfully.`);
        } else {
          showSuccess(`${pairs.length} jobs started successfully!`);
        }
        
        queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session.user.id] });
        resetBatchForm();
        setIsLoading(false);
    };

    const addPrecisePair = () => {
        if (tempPairPerson && tempPairGarment) {
          setPrecisePairs(prev => [...prev, { person: tempPairPerson, garment: tempPairGarment, appendix: tempPairAppendix }]);
          setTempPairPerson(null);
          setTempPairGarment(null);
          setTempPairAppendix("");
        }
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

    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                    <CardHeader><CardTitle>1. Select Models & Garments</CardTitle></CardHeader>
                    <CardContent className="space-y-4">
                        <Tabs defaultValue="one-garment" onValueChange={setBatchMode}>
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="one-garment" title={t('oneGarment')}><Shirt className="h-4 w-4 mr-2" />One Garment</TabsTrigger>
                                <TabsTrigger value="random" title={t('randomPairs')}><Users className="h-4 w-4 mr-2" />Random Pairs</TabsTrigger>
                            </TabsList>
                            <TabsContent value="one-garment" className="pt-4 space-y-4">
                                <Button variant="outline" className="w-full" onClick={() => setIsModelModalOpen(true)}>Select Models ({selectedModelUrls.size})</Button>
                                <ImageUploader onFileSelect={setBatchGarmentFile} title={t('uploadGarment')} imageUrl={batchGarmentFile ? URL.createObjectURL(batchGarmentFile) : null} onClear={() => setBatchGarmentFile(null)} />
                            </TabsContent>
                            <TabsContent value="random" className="pt-4 space-y-4">
                                <Button variant="outline" className="w-full" onClick={() => setIsModelModalOpen(true)}>Select Models ({selectedModelUrls.size})</Button>
                                <MultiImageUploader onFilesSelect={setBatchRandomGarmentFiles} title={t('uploadGarments')} icon={<Shirt />} description={t('selectMultipleGarmentImages')} />
                            </TabsContent>
                        </Tabs>
                        <div>
                            <Label htmlFor="general-appendix">{t('promptAppendix')}</Label>
                            <Textarea id="general-appendix" value={generalAppendix} onChange={(e) => setGeneralAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
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
                                        {batchMode === 'one-garment' && batchGarmentFile && <img src={URL.createObjectURL(batchGarmentFile)} className="w-full h-full object-cover rounded-md aspect-square" />}
                                        {batchMode === 'random' && batchRandomGarmentFiles.map((file, i) => <img key={i} src={URL.createObjectURL(file)} className="w-full h-full object-cover rounded-md aspect-square" />)}
                                    </div>
                                </ScrollArea>
                            </div>
                        </div>
                        <Button size="lg" className="w-full" onClick={handleBatchSubmit} disabled={isLoading || selectedModelUrls.size === 0 || (batchMode === 'one-garment' && !batchGarmentFile) || (batchMode === 'random' && batchRandomGarmentFiles.length === 0)}>
                            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                            Generate Combinations
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