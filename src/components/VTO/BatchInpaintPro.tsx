import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Wand2, Loader2, X, PlusCircle, Shirt, Users, Link2, Sparkles } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { useQueryClient } from "@tanstack/react-query";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

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

export const BatchInpaintPro = () => {
    const { supabase, session } = useSession();
    const { t } = useLanguage();
    const queryClient = useQueryClient();

    const [precisePairs, setPrecisePairs] = useState<{ person: File, garment: File, appendix: string, isHelperEnabled: boolean }[]>([]);
    const [tempPairPerson, setTempPairPerson] = useState<File | null>(null);
    const [tempPairGarment, setTempPairGarment] = useState<File | null>(null);
    const [tempPairAppendix, setTempPairAppendix] = useState("");
    const [isHelperEnabled, setIsHelperEnabled] = useState(true);
    const [isLoading, setIsLoading] = useState(false);

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

    const resetForm = () => {
        setPrecisePairs([]);
    };

    const handleBatchSubmit = async () => {
        if (precisePairs.length === 0) return showError("Please add at least one precise pair.");
    
        setIsLoading(true);
        const toastId = showLoading(`Queuing ${precisePairs.length} jobs...`);
        
        try {
            const uploadPromises = precisePairs.map(async (pair) => {
                const [person_url, garment_url] = await Promise.all([
                    uploadFile(pair.person, 'person'),
                    uploadFile(pair.garment, 'garment')
                ]);
                return { person_url, garment_url, appendix: pair.appendix, is_helper_enabled: pair.isHelperEnabled };
            });

            const uploadedPairs = await Promise.all(uploadPromises);

            const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-batch-inpaint', {
                body: {
                    pairs: uploadedPairs,
                    user_id: session?.user?.id
                }
            });

            if (error) throw error;

            dismissToast(toastId);
            showSuccess(`${precisePairs.length} jobs have been queued for processing.`);
            queryClient.invalidateQueries({ queryKey: ['activeJobs'] });
            resetForm();
        } catch (err: any) {
            dismissToast(toastId);
            showError(`Failed to queue batch job: ${err.message}`);
        } finally {
            setIsLoading(false);
        }
    };

    const addPrecisePair = () => {
        if (tempPairPerson && tempPairGarment) {
          setPrecisePairs(prev => [...prev, { person: tempPairPerson, garment: tempPairGarment, appendix: tempPairAppendix, isHelperEnabled }]);
          setTempPairPerson(null);
          setTempPairGarment(null);
          setTempPairAppendix("");
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <Card>
                <CardHeader>
                    <CardTitle>1. Create a Pair</CardTitle>
                    <CardDescription>{t('precisePairsDescription')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                        <ImageUploader onFileSelect={setTempPairPerson} title={t('person')} imageUrl={tempPairPerson ? URL.createObjectURL(tempPairPerson) : null} onClear={() => setTempPairPerson(null)} />
                        <ImageUploader onFileSelect={setTempPairGarment} title={t('garment')} imageUrl={tempPairGarment ? URL.createObjectURL(tempPairGarment) : null} onClear={() => setTempPairGarment(null)} />
                    </div>
                    <div>
                        <Label htmlFor="pair-appendix">{t('promptAppendixPair')}</Label>
                        <Input id="pair-appendix" value={tempPairAppendix} onChange={(e) => setTempPairAppendix(e.target.value)} placeholder={t('promptAppendixPairPlaceholder')} />
                    </div>
                    <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                        <Label htmlFor="ai-prompt-helper" className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-primary" />
                            {t('aiPromptHelper')}
                        </Label>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>{t('aiPromptHelperDescription')}</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <Switch id="ai-prompt-helper" checked={isHelperEnabled} onCheckedChange={setIsHelperEnabled} />
                    </div>
                    <Button className="w-full" onClick={addPrecisePair} disabled={!tempPairPerson || !tempPairGarment}>{t('addPair')}</Button>
                </CardContent>
              </Card>
              <Button size="lg" className="w-full mt-4" onClick={handleBatchSubmit} disabled={isLoading || precisePairs.length === 0}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Start Batch Inpaint ({precisePairs.length})
              </Button>
            </div>
            <div className="lg:col-span-2">
              <Card className="min-h-[75vh]">
                <CardHeader><CardTitle>{t('batchQueue')}</CardTitle></CardHeader>
                <CardContent>
                  <ScrollArea className="h-[65vh]">
                    {precisePairs.length > 0 ? (
                      <div className="space-y-2">
                        {precisePairs.map((pair, i) => (
                          <div key={i} className="flex gap-2 items-center bg-muted p-2 rounded-md">
                            <img src={URL.createObjectURL(pair.person)} className="w-16 h-16 object-cover rounded-md" />
                            <PlusCircle className="h-5 w-5 text-muted-foreground" />
                            <img src={URL.createObjectURL(pair.garment)} className="w-16 h-16 object-cover rounded-md" />
                            <div className="flex-1 overflow-hidden">
                                <p className="text-xs text-muted-foreground truncate italic">"{pair.appendix}"</p>
                                <p className="text-xs font-semibold">{pair.isHelperEnabled ? "AI Prompt: ON" : "AI Prompt: OFF"}</p>
                            </div>
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPrecisePairs(p => p.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                        <div className="text-center text-muted-foreground py-16">
                            <p>Add pairs using the form on the left.</p>
                        </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
        </div>
    )
}