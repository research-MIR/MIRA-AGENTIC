import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ModelSelector } from "@/components/ModelSelector";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { Sparkles, Wand2, UploadCloud, X, GalleryHorizontal, PlusCircle } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/context/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { GeneratorJobThumbnail } from "@/components/Jobs/GeneratorJobThumbnail";
import { Skeleton } from "@/components/ui/skeleton";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useGeneratorStore } from "@/store/generatorStore";

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

const ImageUploader = ({ onFileSelect, title, t, imageUrl, onClear }: { onFileSelect: (files: FileList | null) => void, title: string, t: any, imageUrl: string | null, onClear: () => void }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: onFileSelect });

  if (!imageUrl) {
    return (
      <div 
        {...dropzoneProps}
        className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed border-border px-6 py-4 transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")}
        onClick={() => inputRef.current?.click()}
      >
        <div className="text-center pointer-events-none">
          <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 flex text-sm leading-6 text-muted-foreground">
            <span className="relative rounded-md bg-background font-semibold text-primary">{title}</span>
          </p>
        </div>
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => onFileSelect(e.target.files)} />
      </div>
    );
  }

  return (
    <div className="relative aspect-square">
      <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
      <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 z-10" onClick={onClear}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};

const Generator = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const channelRef = useRef<RealtimeChannel | null>(null);

  const {
    prompt, negativePrompt, numImages, seed, selectedModelId, aspectRatio,
    styleReferenceFile, garmentReferenceFiles, isHelperEnabled, isLoading,
    finalPromptUsed, recentJobs, selectedJobId, isFetchingJobs,
    setField, reset, handleFileSelect, removeGarmentFile, clearStyleFile,
    fetchRecentJobs, selectJob, generate
  } = useGeneratorStore();

  const styleReferenceImageUrl = useMemo(() => styleReferenceFile ? URL.createObjectURL(styleReferenceFile) : null, [styleReferenceFile]);
  const garmentReferenceImageUrls = useMemo(() => garmentReferenceFiles.map(file => URL.createObjectURL(file)), [garmentReferenceFiles]);

  useEffect(() => {
    if (session?.user) {
      fetchRecentJobs(session.user.id);
    }
  }, [session?.user, fetchRecentJobs]);

  useEffect(() => {
    if (!session?.user?.id) {
      console.log("[Generator Realtime] No user session, skipping subscription.");
      return;
    }
    const userId = session.user.id;
    console.log(`[Generator Realtime] Setting up subscription for user: ${userId}`);

    const channel = supabase.channel(`direct-generator-jobs-tracker-${userId}`)
      .on(
        'postgres_changes', 
        { event: '*', schema: 'public', table: 'mira-agent-jobs' }, // REMOVED filter
        (payload) => {
          console.log('[Generator Realtime] Received payload:', payload);
          const job = payload.new as any;
          // Client-side filtering
          if (job?.user_id === userId && job?.context?.source === 'direct_generator') {
            console.log(`[Generator Realtime] Job ${job.id} matches user and source. Fetching recent jobs.`);
            fetchRecentJobs(userId);
          } else {
            console.log(`[Generator Realtime] Job update received, but it's not for this user or not from the direct generator. Ignoring.`);
          }
        }
      )
      .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
              console.log(`[Generator Realtime] Successfully subscribed to channel for user ${userId}!`);
          }
          if (status === 'CHANNEL_ERROR') {
              console.error('[Generator Realtime] Subscription failed:', err);
          }
          if (status === 'TIMED_OUT') {
              console.warn('[Generator Realtime] Subscription timed out.');
          }
      });
      
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        console.log(`[Generator Realtime] Cleaning up and removing channel for user ${userId}.`);
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [supabase, session?.user?.id, fetchRecentJobs]);

  useEffect(() => {
    return () => {
      if (styleReferenceImageUrl) URL.revokeObjectURL(styleReferenceImageUrl);
      garmentReferenceImageUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [styleReferenceImageUrl, garmentReferenceImageUrls]);

  const handleGenerateClick = async () => {
    if (!session?.user) return;
    const toastId = showLoading("Warming up the engines...");
    const result = await generate(session.user.id);
    dismissToast(toastId);
    if (result.success) {
      showSuccess(result.message);
    } else {
      showError(result.message);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t.imageGenerator}</h1>
          <p className="text-muted-foreground">{t.generatorIntro}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card id="generator-prompt-card">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>{selectedJobId ? t.loadedJob : t.newGeneration}</CardTitle>
                {selectedJobId && <Button variant="outline" size="sm" onClick={reset}><PlusCircle className="h-4 w-4 mr-2" />{t.newJob}</Button>}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="prompt">{t.prompt}</Label>
                  <Textarea id="prompt" value={prompt} onChange={(e) => setField('prompt', e.target.value)} placeholder={t.promptPlaceholderGenerator} rows={6} />
                </div>
                <div>
                  <Label htmlFor="negative-prompt">{t.negativePrompt}</Label>
                  <Textarea id="negative-prompt" value={negativePrompt} onChange={(e) => setField('negativePrompt', e.target.value)} placeholder={t.negativePromptPlaceholder} rows={3} />
                </div>
                <Accordion type="single" collapsible className="w-full">
                  <AccordionItem value="item-1">
                    <AccordionTrigger>{t.referenceImagesOptional}</AccordionTrigger>
                    <AccordionContent className="space-y-4 pt-4">
                      <ImageUploader onFileSelect={(files) => handleFileSelect('garment', files)} title={t.garmentReference} t={t} imageUrl={null} onClear={() => {}} />
                      {garmentReferenceImageUrls.length > 0 && (
                        <div className="grid grid-cols-3 gap-2">
                          {garmentReferenceImageUrls.map((url, index) => (
                            <div key={index} className="relative">
                              <img src={url} alt={`Garment ${index + 1}`} className="w-full h-24 object-cover rounded-md" />
                              <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6" onClick={() => removeGarmentFile(index)}><X className="h-4 w-4" /></Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <ImageUploader onFileSelect={(files) => handleFileSelect('style', files)} title={t.styleReference} t={t} imageUrl={styleReferenceImageUrl} onClear={clearStyleFile} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <Card id="generator-settings-card">
            <CardHeader><CardTitle>{t.configureSettings}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
                <div className="space-y-0.5">
                  <Label>{t.aiPromptHelper}</Label>
                  <p className="text-[0.8rem] text-muted-foreground">{t.aiPromptHelperDescription}</p>
                </div>
                <Switch checked={isHelperEnabled} onCheckedChange={(checked) => setField('isHelperEnabled', checked)} />
              </div>
              <div>
                <Label>{t.model}</Label>
                <ModelSelector selectedModelId={selectedModelId} onModelChange={(val) => setField('selectedModelId', val)} />
              </div>
              <div>
                <Label>{t.aspectRatio}</Label>
                <Select value={aspectRatio} onValueChange={(val) => setField('aspectRatio', val)}>
                  <SelectTrigger><SelectValue placeholder="Select aspect ratio..." /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(aspectRatioOptions).map(([value, { label }]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="num-images">{t.images}</Label>
                  <Input id="num-images" type="number" value={numImages} onChange={(e) => setField('numImages', Math.max(1, parseInt(e.target.value, 10)))} min="1" max="8" />
                </div>
                <div>
                  <Label htmlFor="seed">{t.seed}</Label>
                  <Input id="seed" type="number" placeholder="Random" value={seed || ''} onChange={(e) => setField('seed', e.target.value ? parseInt(e.target.value, 10) : undefined)} />
                </div>
              </div>
            </CardContent>
          </Card>
          <Button onClick={handleGenerateClick} disabled={isLoading} className="w-full">
            {isLoading ? <Wand2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
            {t.generate}
          </Button>
        </div>

        <div className="lg:col-span-1">
          <Card className="min-h-[60vh]">
            <CardHeader><CardTitle>{t.results}</CardTitle></CardHeader>
            <CardContent>
              {finalPromptUsed && (
                <div className="mb-4">
                  <Label>{t.finalPromptUsed}</Label>
                  <Textarea readOnly value={finalPromptUsed} className="mt-1 h-24 font-mono text-xs" />
                </div>
              )}
              <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-64">
                <Sparkles className="h-12 w-12 mb-4" />
                <p>{t.galleryPlaceholder}</p>
                <Button variant="outline" className="mt-4" onClick={() => navigate('/gallery')}><GalleryHorizontal className="mr-2 h-4 w-4" />{t.goToGallery}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-8">
        <CardHeader><CardTitle>{t.recentGenerations}</CardTitle></CardHeader>
        <CardContent>
          {isFetchingJobs ? (
            <div className="flex gap-4"><Skeleton className="h-24 w-24" /><Skeleton className="h-24 w-24" /><Skeleton className="h-24 w-24" /></div>
          ) : recentJobs && recentJobs.length > 0 ? (
            <div className="flex gap-4 overflow-x-auto pb-2">
              {recentJobs.map(job => <GeneratorJobThumbnail key={job.id} job={job} onClick={() => selectJob(job)} isSelected={selectedJobId === job.id} />)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-center text-muted-foreground h-24"><p>{t.noRecentJobs}</p></div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Generator;