import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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

export const BatchTryOn = () => {
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
        let pairs: { person: File, garment: File, appendix?: string }[] = [];
        if (batchMode === 'one-garment') {
          if (!batchGarmentFile || batchPersonFiles.length === 0) return showError("Please provide one garment and at least one person image.");
          pairs = batchPersonFiles.map(person => ({ person, garment: batchGarmentFile, appendix: generalAppendix }));
        } else if (batchMode === 'random') {
          if (batchRandomPersonFiles.length === 0 || batchRandomGarmentFiles.length === 0) return showError("Please provide at least one person and one garment image for random pairing.");
          const shuffledPeople = [...batchRandomPersonFiles].sort(() => 0.5 - Math.random());
          const shuffledGarments = [...batchRandomGarmentFiles].sort(() => 0.5 - Math.random());
          const numPairs = Math.min(shuffledPeople.length, shuffledGarments.length);
          for (let i = 0; i < numPairs; i++) {
            pairs.push({ person: shuffledPeople[i], garment: shuffledGarments[i], appendix: generalAppendix });
          }
        } else if (batchMode === 'precise') {
          if (precisePairs.length === 0) return showError("Please add at least one precise pair.");
          pairs = precisePairs;
        }
    
        if (pairs.length === 0) return showError("No valid pairs to process.");
    
        setIsLoading(true);
        const toastId = showLoading(`Queuing ${pairs.length} jobs...`);
        
        const jobPromises = pairs.map(async (pair) => {
            const person_image_url = await uploadFile(pair.person, 'person');
            const garment_image_url = await uploadFile(pair.garment, 'garment');
            
            const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
                body: { person_image_url, garment_image_url, prompt_appendix: pair.appendix }
            });
            if (promptError) throw promptError;
            const autoPrompt = promptData.final_prompt;
    
            const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
                body: { 
                    person_image_url, 
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

    return (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 max-w-7xl mx-auto">
            <div className="space-y-6">
              <Card>
                <CardHeader><CardTitle>{t('batchMode')}</CardTitle><CardDescription>{t('chooseBatchMethod')}</CardDescription></CardHeader>
                <CardContent>
                  <Tabs defaultValue="one-garment" onValueChange={setBatchMode}>
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="one-garment" title={t('oneGarment')}><Shirt className="h-4 w-4" /></TabsTrigger>
                      <TabsTrigger value="random" title={t('randomPairs')}><Users className="h-4 w-4" /></TabsTrigger>
                      <TabsTrigger value="precise" title={t('precisePairs')}><Link2 className="h-4 w-4" /></TabsTrigger>
                    </TabsList>
                    <TabsContent value="one-garment" className="pt-4 space-y-4">
                      <p className="text-sm text-muted-foreground">{t('oneGarmentDescription')}</p>
                      <div className="grid grid-cols-2 gap-4">
                        <ImageUploader onFileSelect={setBatchGarmentFile} title={t('uploadGarment')} imageUrl={batchGarmentFile ? URL.createObjectURL(batchGarmentFile) : null} onClear={() => setBatchGarmentFile(null)} />
                        <MultiImageUploader onFilesSelect={setBatchPersonFiles} title={t('uploadPeople')} icon={<Users />} description={t('selectMultiplePersonImages')} />
                      </div>
                      <div>
                        <Label htmlFor="general-appendix">{t('promptAppendix')}</Label>
                        <Textarea id="general-appendix" value={generalAppendix} onChange={(e) => setGeneralAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
                      </div>
                    </TabsContent>
                    <TabsContent value="random" className="pt-4 space-y-4">
                      <p className="text-sm text-muted-foreground">{t('randomPairsDescription')}</p>
                      <div className="grid grid-cols-2 gap-4">
                        <MultiImageUploader onFilesSelect={setBatchRandomGarmentFiles} title={t('uploadGarments')} icon={<Shirt />} description={t('selectMultipleGarmentImages')} />
                        <MultiImageUploader onFilesSelect={setBatchRandomPersonFiles} title={t('uploadPeople')} icon={<Users />} description={t('selectMultiplePersonImages')} />
                      </div>
                       <div>
                        <Label htmlFor="general-appendix-random">{t('promptAppendix')}</Label>
                        <Textarea id="general-appendix-random" value={generalAppendix} onChange={(e) => setGeneralAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
                      </div>
                    </TabsContent>
                    <TabsContent value="precise" className="pt-4 space-y-4">
                      <p className="text-sm text-muted-foreground">{t('precisePairsDescription')}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <ImageUploader onFileSelect={setTempPairPerson} title={t('person')} imageUrl={tempPairPerson ? URL.createObjectURL(tempPairPerson) : null} onClear={() => setTempPairPerson(null)} />
                        <ImageUploader onFileSelect={setTempPairGarment} title={t('garment')} imageUrl={tempPairGarment ? URL.createObjectURL(tempPairGarment) : null} onClear={() => setTempPairGarment(null)} />
                      </div>
                      <div>
                        <Label htmlFor="pair-appendix">{t('promptAppendixPair')}</Label>
                        <Input id="pair-appendix" value={tempPairAppendix} onChange={(e) => setTempPairAppendix(e.target.value)} placeholder={t('promptAppendixPairPlaceholder')} />
                      </div>
                      <Button className="w-full" onClick={addPrecisePair} disabled={!tempPairPerson || !tempPairGarment}>{t('addPair')}</Button>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
              <Button size="lg" className="w-full" onClick={handleBatchSubmit} disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                {t('startBatchTryOn')}
              </Button>
            </div>
            <div>
              <Card className="min-h-[75vh]">
                <CardHeader><CardTitle>{t('batchQueue')}</CardTitle></CardHeader>
                <CardContent>
                  <ScrollArea className="h-[65vh]">
                    {batchMode === 'one-garment' && batchPersonFiles.length > 0 && (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {batchPersonFiles.map((file, i) => <div key={i} className="aspect-square"><img src={URL.createObjectURL(file)} className="w-full h-full object-cover rounded-md" /></div>)}
                      </div>
                    )}
                    {batchMode === 'random' && (batchRandomPersonFiles.length > 0 || batchRandomGarmentFiles.length > 0) && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <h3 className="font-semibold">{t('peopleCount', { count: batchRandomPersonFiles.length })}</h3>
                          <div className="grid grid-cols-3 gap-2">{batchRandomPersonFiles.map((f, i) => <img key={i} src={URL.createObjectURL(f)} className="w-full h-full object-cover rounded-md aspect-square" />)}</div>
                        </div>
                        <div className="space-y-2">
                          <h3 className="font-semibold">{t('garmentsCount', { count: batchRandomGarmentFiles.length })}</h3>
                          <div className="grid grid-cols-3 gap-2">{batchRandomGarmentFiles.map((f, i) => <img key={i} src={URL.createObjectURL(f)} className="w-full h-full object-cover rounded-md aspect-square" />)}</div>
                        </div>
                      </div>
                    )}
                    {batchMode === 'precise' && precisePairs.length > 0 && (
                      <div className="space-y-2">
                        {precisePairs.map((pair, i) => (
                          <div key={i} className="flex gap-2 items-center bg-muted p-2 rounded-md">
                            <img src={URL.createObjectURL(pair.person)} className="w-16 h-16 object-cover rounded-md" />
                            <PlusCircle className="h-5 w-5 text-muted-foreground" />
                            <img src={URL.createObjectURL(pair.garment)} className="w-16 h-16 object-cover rounded-md" />
                            <p className="text-xs text-muted-foreground flex-1 truncate italic">"{pair.appendix}"</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
        </div>
    )
};