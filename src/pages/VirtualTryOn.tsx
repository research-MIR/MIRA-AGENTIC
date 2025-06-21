import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { UploadCloud, Wand2, Loader2, Image as ImageIcon, X, PlusCircle, AlertTriangle, Sparkles, Shirt, Users, Link2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useSecureImage } from "@/hooks/useSecureImage";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Label } from "@/components/ui/label";
import { optimizeImage, sanitizeFilename } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

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

const MultiImageUploader = ({ onFilesSelect, title, icon, description }: { onFilesSelect: (files: File[]) => void, title: string, icon: React.ReactNode, description: string }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFilesSelect(Array.from(e.dataTransfer.files)) });

  return (
    <div {...dropzoneProps} className={cn("flex flex-col justify-center items-center rounded-lg border border-dashed p-6 transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
      {icon}
      <p className="mt-2 font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
      <Input ref={inputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e) => e.target.files && onFilesSelect(Array.from(e.target.files))} />
    </div>
  );
};

const VirtualTryOn = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { showImage } = useImagePreview();
  
  // Single Mode State
  const [personImageFile, setPersonImageFile] = useState<File | null>(null);
  const [garmentImageFile, setGarmentImageFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [isAutoPromptEnabled, setIsAutoPromptEnabled] = useState(true);
  const [promptReady, setPromptReady] = useState(false);

  // Batch Mode State
  const [batchMode, setBatchMode] = useState('one-garment');
  const [batchGarmentFile, setBatchGarmentFile] = useState<File | null>(null);
  const [batchPersonFiles, setBatchPersonFiles] = useState<File[]>([]);
  const [batchRandomGarmentFiles, setBatchRandomGarmentFiles] = useState<File[]>([]);
  const [batchRandomPersonFiles, setBatchRandomPersonFiles] = useState<File[]>([]);
  const [precisePairs, setPrecisePairs] = useState<{ person: File, garment: File }[]>([]);
  const [tempPairPerson, setTempPairPerson] = useState<File | null>(null);
  const [tempPairGarment, setTempPairGarment] = useState<File | null>(null);

  // Shared State
  const [isLoading, setIsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const { data: recentJobs, isLoading: isLoadingRecentJobs } = useQuery<BitStudioJob[]>({
    queryKey: ['bitstudioJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => recentJobs?.find(job => job.id === selectedJobId), [recentJobs, selectedJobId]);

  useEffect(() => {
    if (!session?.user?.id) return;
    const channel = supabase.channel(`bitstudio-jobs-tracker-${session.user.id}`)
      .on<BitStudioJob>('postgres_changes', { event: '*', schema: 'public', table: 'mira-agent-bitstudio-jobs', filter: `user_id=eq.${session.user.id}` },
        () => queryClient.invalidateQueries({ queryKey: ['bitstudioJobs'] })
      ).subscribe();
    channelRef.current = channel;
    return () => { if (channelRef.current) supabase.removeChannel(channelRef.current); };
  }, [supabase, session?.user?.id, queryClient]);

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

  const queueTryOnJob = async (personFile: File, garmentFile: File) => {
    if (!session?.user) throw new Error("User session not found.");
    const person_image_url = await uploadFile(personFile, 'person');
    const garment_image_url = await uploadFile(garmentFile, 'garment');
    const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
      body: { person_image_url, garment_image_url, user_id: session.user.id, mode: 'base' }
    });
    if (error) throw error;
  };

  const handleTryOn = async () => {
    if (!personImageFile || !garmentImageFile) return showError("Please upload both a person and a garment image.");
    setIsLoading(true);
    const toastId = showLoading("Starting Virtual Try-On job...");
    try {
      await queueTryOnJob(personImageFile, garmentImageFile);
      dismissToast(toastId);
      showSuccess("Virtual Try-On job started!");
      queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session.user.id] });
      resetForm();
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleBatchSubmit = async () => {
    let pairs: { person: File, garment: File }[] = [];
    if (batchMode === 'one-garment') {
      if (!batchGarmentFile || batchPersonFiles.length === 0) return showError("Please provide one garment and at least one person image.");
      pairs = batchPersonFiles.map(person => ({ person, garment: batchGarmentFile }));
    } else if (batchMode === 'random') {
      if (batchRandomPersonFiles.length === 0 || batchRandomGarmentFiles.length === 0) return showError("Please provide at least one person and one garment image for random pairing.");
      const shuffledPeople = [...batchRandomPersonFiles].sort(() => 0.5 - Math.random());
      const shuffledGarments = [...batchRandomGarmentFiles].sort(() => 0.5 - Math.random());
      const numPairs = Math.min(shuffledPeople.length, shuffledGarments.length);
      for (let i = 0; i < numPairs; i++) {
        pairs.push({ person: shuffledPeople[i], garment: shuffledGarments[i] });
      }
    } else if (batchMode === 'precise') {
      if (precisePairs.length === 0) return showError("Please add at least one precise pair.");
      pairs = precisePairs;
    }

    if (pairs.length === 0) return showError("No valid pairs to process.");

    setIsLoading(true);
    const toastId = showLoading(`Queuing ${pairs.length} jobs...`);
    const results = await Promise.allSettled(pairs.map(p => queueTryOnJob(p.person, p.garment)));
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

  const resetForm = () => {
    setPersonImageFile(null);
    setGarmentImageFile(null);
    setSelectedJobId(null);
    setPrompt("");
    setPromptReady(false);
    setIsAutoPromptEnabled(true);
  };

  const resetBatchForm = () => {
    setBatchGarmentFile(null);
    setBatchPersonFiles([]);
    setBatchRandomGarmentFiles([]);
    setBatchRandomPersonFiles([]);
    setPrecisePairs([]);
  };

  const handleSelectJob = (job: BitStudioJob) => {
    setSelectedJobId(job.id);
    setPersonImageFile(null);
    setGarmentImageFile(null);
    setPrompt("");
    setPromptReady(false);
    setIsAutoPromptEnabled(false);
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

  const addPrecisePair = () => {
    if (tempPairPerson && tempPairGarment) {
      setPrecisePairs(prev => [...prev, { person: tempPairPerson, garment: tempPairGarment }]);
      setTempPairPerson(null);
      setTempPairGarment(null);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('virtualTryOn')}</h1>
        <p className="text-muted-foreground">{t('vtoDescription')}</p>
      </header>
      <Tabs defaultValue="single" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="single">{t('singleTryOn')}</TabsTrigger>
          <TabsTrigger value="batch">{t('batchProcess')}</TabsTrigger>
        </TabsList>
        <TabsContent value="single" className="pt-6">
          <p className="text-sm text-muted-foreground mb-6">{t('singleVtoDescription')}</p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <Card>
                <CardHeader><div className="flex justify-between items-center"><CardTitle>{selectedJobId ? "Selected Job" : "1. Upload Images"}</CardTitle>{selectedJobId && <Button variant="outline" size="sm" onClick={resetForm}><PlusCircle className="h-4 w-4 mr-2" />New</Button>}</div></CardHeader>
                <CardContent className="grid grid-cols-2 gap-4">
                  {selectedJob ? (
                    <>
                      <SecureImageDisplay imageUrl={selectedJob.source_person_image_url} alt="Person" onClick={() => showImage({ images: [{ url: selectedJob.source_person_image_url }], currentIndex: 0 })} />
                      <SecureImageDisplay imageUrl={selectedJob.source_garment_image_url} alt="Garment" onClick={() => showImage({ images: [{ url: selectedJob.source_garment_image_url }], currentIndex: 0 })} />
                    </>
                  ) : (
                    <>
                      <ImageUploader onFileSelect={setPersonImageFile} title="Person Image" imageUrl={personImageUrl} onClear={() => setPersonImageFile(null)} />
                      <ImageUploader onFileSelect={setGarmentImageFile} title="Garment Image" imageUrl={garmentImageUrl} onClear={() => setGarmentImageFile(null)} />
                    </>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <div className="flex justify-between items-center">
                    <CardTitle>2. Prompt</CardTitle>
                    <div className="flex items-center space-x-2">
                      <Label htmlFor="auto-prompt" className="text-sm text-muted-foreground">Auto-Generate</Label>
                      <Switch id="auto-prompt" checked={isAutoPromptEnabled} onCheckedChange={setIsAutoPromptEnabled} disabled={!!selectedJobId} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A detailed prompt will appear here..." rows={4} disabled={isAutoPromptEnabled} />
                  {isGeneratingPrompt && <div className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating prompt...</div>}
                </CardContent>
              </Card>
              <Button onClick={handleTryOn} disabled={isTryOnDisabled} className="w-full">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                Start Virtual Try-On
              </Button>
            </div>
            <div className="lg:col-span-2">
              <Card className="h-[75vh] flex flex-col">
                <CardHeader><CardTitle>Result</CardTitle></CardHeader>
                <CardContent className="flex-1 flex items-center justify-center overflow-hidden p-2">
                  {selectedJob ? renderJobResult(selectedJob) : <div className="text-center text-muted-foreground"><ImageIcon className="h-16 w-16 mx-auto mb-4" /><p>Your result will appear here.</p></div>}
                </CardContent>
              </Card>
              <Card className="mt-8">
                <CardHeader><CardTitle>Recent Jobs</CardTitle></CardHeader>
                <CardContent>
                  {isLoadingRecentJobs ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {recentJobs.map(job => {
                        const urlToPreview = job.final_image_url || job.source_person_image_url;
                        return (
                          <button key={job.id} onClick={() => handleSelectJob(job)} className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24", selectedJobId === job.id ? "border-primary" : "border-transparent")}>
                            <SecureImageDisplay imageUrl={urlToPreview} alt="Recent job" />
                          </button>
                        )
                      })}
                    </div>
                  ) : <p className="text-muted-foreground text-sm">No recent jobs found.</p>}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="batch" className="pt-6">
          <p className="text-sm text-muted-foreground mb-6">{t('batchVtoDescription')}</p>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-1 space-y-6">
              <Card>
                <CardHeader><CardTitle>Batch Mode</CardTitle><CardDescription>Choose a method for batch processing.</CardDescription></CardHeader>
                <CardContent>
                  <Tabs defaultValue="one-garment" onValueChange={setBatchMode}>
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="one-garment" title={t('oneGarment')}><Shirt className="h-4 w-4" /></TabsTrigger>
                      <TabsTrigger value="random" title={t('randomPairs')}><Users className="h-4 w-4" /></TabsTrigger>
                      <TabsTrigger value="precise" title={t('precisePairs')}><Link2 className="h-4 w-4" /></TabsTrigger>
                    </TabsList>
                    <TabsContent value="one-garment" className="pt-4 space-y-4">
                      <p className="text-sm text-muted-foreground">{t('oneGarmentDescription')}</p>
                      <ImageUploader onFileSelect={setBatchGarmentFile} title="Upload Garment" imageUrl={batchGarmentFile ? URL.createObjectURL(batchGarmentFile) : null} onClear={() => setBatchGarmentFile(null)} />
                      <MultiImageUploader onFilesSelect={setBatchPersonFiles} title="Upload People" icon={<Users className="h-8 w-8 text-muted-foreground" />} description="Select multiple person images." />
                    </TabsContent>
                    <TabsContent value="random" className="pt-4 space-y-4">
                      <p className="text-sm text-muted-foreground">{t('randomPairsDescription')}</p>
                      <MultiImageUploader onFilesSelect={setBatchRandomGarmentFiles} title="Upload Garments" icon={<Shirt className="h-8 w-8 text-muted-foreground" />} description="Select multiple garment images." />
                      <MultiImageUploader onFilesSelect={setBatchRandomPersonFiles} title="Upload People" icon={<Users className="h-8 w-8 text-muted-foreground" />} description="Select multiple person images." />
                    </TabsContent>
                    <TabsContent value="precise" className="pt-4 space-y-4">
                      <p className="text-sm text-muted-foreground">{t('precisePairsDescription')}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <ImageUploader onFileSelect={setTempPairPerson} title="Person" imageUrl={tempPairPerson ? URL.createObjectURL(tempPairPerson) : null} onClear={() => setTempPairPerson(null)} />
                        <ImageUploader onFileSelect={setTempPairGarment} title="Garment" imageUrl={tempPairGarment ? URL.createObjectURL(tempPairGarment) : null} onClear={() => setTempPairGarment(null)} />
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
            <div className="lg:col-span-2">
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
                          <h3 className="font-semibold">People ({batchRandomPersonFiles.length})</h3>
                          <div className="grid grid-cols-3 gap-2">{batchRandomPersonFiles.map((f, i) => <img key={i} src={URL.createObjectURL(f)} className="w-full h-full object-cover rounded-md aspect-square" />)}</div>
                        </div>
                        <div className="space-y-2">
                          <h3 className="font-semibold">Garments ({batchRandomGarmentFiles.length})</h3>
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
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const SecureImageDisplay = ({ imageUrl, alt, onClick }: { imageUrl: string | null, alt: string, onClick?: (e: React.MouseEvent<HTMLImageElement>) => void }) => {
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
  const hasClickHandler = !!onClick;

  if (!imageUrl) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
  if (isLoading) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
  
  return <img src={displayUrl} alt={alt} className={cn("w-full h-full object-cover rounded-md", hasClickHandler && "cursor-pointer")} onClick={onClick} />;
};

export default VirtualTryOn;