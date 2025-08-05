import React, { useEffect, useRef } from "react";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Image as ImageIcon, Sparkles, Wand2, Info, UploadCloud, X, Shirt, Palette } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";
import { ModelSelector } from "@/components/ModelSelector";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useGeneratorStore } from "@/store/generatorStore";
import { GeneratorJobThumbnail } from "@/components/Jobs/GeneratorJobThumbnail";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { RealtimeChannel } from "@supabase/supabase-js";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

const FileUploader = ({ onFileSelect, children, multiple = false }: { onFileSelect: (files: FileList | null) => void, children: React.ReactNode, multiple?: boolean }) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary transition-colors" onClick={() => inputRef.current?.click()}>
      {children}
      <Input ref={inputRef} type="file" multiple={multiple} className="hidden" accept="image/*" onChange={(e) => onFileSelect(e.target.files)} />
    </div>
  );
};

const modelAspectRatioMap: Record<string, string[]> = {
    google: ['1024x1024', '768x1408', '1408x768', '1280x896', '896x1280'],
    'fal.ai': ['square_hd', 'portrait_16_9', 'landscape_16_9', 'portrait_4_3', 'landscape_4_3', 'portrait_2_3', 'landscape_3_2'],
};

const resolutionToRatioMap: { [key: string]: string } = {
  '1024x1024': '1:1 HD',
  '1408x768': '16:9',
  '768x1408': '9:16',
  '1280x896': '4:3',
  '896x1280': '3:4',
  'square_hd': '1:1 HD',
  'square': '1:1',
  'portrait_4_3': '3:4',
  'portrait_16_9': '9:16',
  'landscape_4_3': '4:3',
  'landscape_16_9': '16:9',
  'portrait_2_3': '2:3',
  'landscape_3_2': '3:2',
};

const Generator = () => {
  const { session, supabase } = useSession();
  const { t } = useLanguage();
  const { showImage } = useImagePreview();
  const state = useGeneratorStore();
  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (session?.user) {
      state.fetchRecentJobs(session.user.id);
      state.fetchModels();
    }
  }, [session?.user]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const channel = supabase
      .channel(`direct-generator-jobs-tracker-${session.user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mira-agent-jobs',
          filter: `user_id=eq.${session.user.id}`,
        },
        (payload) => {
          const job = payload.new as any;
          if (job?.context?.source === 'direct_generator') {
            console.log('[GeneratorPage] Realtime update for direct generator job received, refetching...');
            state.fetchRecentJobs(session.user!.id);
          }
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [supabase, session?.user?.id, state.fetchRecentJobs]);


  const handleGenerate = async () => {
    if (!session?.user) return;
    const result = await state.generate(session.user.id);
    if (result.success) {
      showSuccess(result.message);
    } else {
      showError(result.message);
    }
  };

  const selectedJob = state.recentJobs.find(j => j.id === state.selectedJobId);
  const selectedModel = state.models.find(m => m.model_id_string === state.selectedModelId);
  const provider = selectedModel?.provider.toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'google';
  const validRatios = modelAspectRatioMap[provider] || modelAspectRatioMap.google;

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('imageGenerator')}</h1>
        <p className="text-muted-foreground">{t('generatorDescription')}</p>
      </header>

      <div className="max-w-screen-2xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column: Controls */}
          <div className="lg:col-span-1 flex flex-col gap-4">
            <div className="flex-grow space-y-4">
              <Accordion type="multiple" defaultValue={['item-1']} className="w-full">
                <AccordionItem value="item-1">
                  <AccordionTrigger className="text-base font-semibold">1. {t('describeYourImage')}</AccordionTrigger>
                  <AccordionContent className="pt-4 space-y-4">
                    <div>
                      <Label htmlFor="prompt">{t('prompt')}</Label>
                      <Textarea id="prompt" value={state.prompt} onChange={(e) => state.setField('prompt', e.target.value)} placeholder={t('promptPlaceholderGenerator')} rows={5} />
                    </div>
                    <div>
                      <Label htmlFor="negative-prompt">{t('negativePrompt')}</Label>
                      <Textarea id="negative-prompt" value={state.negativePrompt} onChange={(e) => state.setField('negativePrompt', e.target.value)} placeholder={t('negativePromptPlaceholder')} rows={2} />
                    </div>
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger className="text-base font-semibold">2. {t('referenceImagesOptional')}</AccordionTrigger>
                  <AccordionContent className="pt-4 space-y-4">
                    <div className="flex items-center space-x-2 p-2 rounded-md bg-muted/50">
                      <Switch id="ai-prompt-helper" checked={state.isHelperEnabled} onCheckedChange={(val) => state.setField('isHelperEnabled', val)} disabled={state.garmentReferenceFiles.length === 0 && !state.styleReferenceFile} />
                      <Label htmlFor="ai-prompt-helper">{t('aiPromptHelper')}</Label>
                      <TooltipProvider><Tooltip><TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger><TooltipContent><p>{t('aiPromptHelperDescription')}</p></TooltipContent></Tooltip></TooltipProvider>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('garmentReference')}</Label>
                      <FileUploader onFileSelect={(files) => state.handleFileSelect('garment', files)} multiple>
                        <Shirt className="mx-auto h-8 w-8 text-muted-foreground" />
                        <p className="mt-2 text-sm font-medium">Upload Garment(s)</p>
                        <p className="text-xs text-muted-foreground">Upload one or more items to build an outfit.</p>
                      </FileUploader>
                      {state.garmentReferenceFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-2">
                          {state.garmentReferenceFiles.map((file, index) => (
                            <div key={index} className="relative">
                              <img src={URL.createObjectURL(file)} alt={file.name} className="w-16 h-16 object-cover rounded-md" />
                              <Button variant="destructive" size="icon" className="absolute -top-2 -right-2 h-5 w-5 rounded-full" onClick={() => state.removeGarmentFile(index)}><X className="h-3 w-3" /></Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>{t('styleReference')}</Label>
                      {state.styleReferenceFile ? (
                        <div className="relative w-full">
                          <img src={URL.createObjectURL(state.styleReferenceFile)} alt="Style reference" className="w-full h-auto object-cover rounded-md" />
                          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6" onClick={state.clearStyleFile}><X className="h-4 w-4" /></Button>
                        </div>
                      ) : (
                        <FileUploader onFileSelect={(files) => state.handleFileSelect('style', files)}>
                          <Palette className="mx-auto h-8 w-8 text-muted-foreground" />
                          <p className="mt-2 text-sm font-medium">Upload Style</p>
                          <p className="text-xs text-muted-foreground">Upload one image to define mood, lighting, and pose.</p>
                        </FileUploader>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <Card>
                <CardHeader><CardTitle className="text-base font-semibold">3. {t('configureSettings')}</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>{t('model')}</Label>
                    <ModelSelector models={state.models} selectedModelId={state.selectedModelId} onModelChange={(val) => state.setField('selectedModelId', val)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="aspect-ratio">{t('aspectRatio')}</Label>
                      <Select value={validRatios.includes(state.aspectRatio) ? state.aspectRatio : ''} onValueChange={(val) => state.setField('aspectRatio', val)}>
                        <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                        <SelectContent>
                          {validRatios.map(option => (
                            <SelectItem key={option} value={option}>{resolutionToRatioMap[option] || option}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {provider === 'fal.ai' && (
                        <Input
                          placeholder="e.g. 21:9"
                          value={!validRatios.includes(state.aspectRatio) ? state.aspectRatio : ''}
                          onChange={(e) => state.setField('aspectRatio', e.target.value)}
                        />
                      )}
                    </div>
                    <div>
                      <Label htmlFor="num-images">{t('images')}</Label>
                      <Select value={String(state.numImages)} onValueChange={(v) => state.setField('numImages', Number(v))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">1</SelectItem>
                          <SelectItem value="2">2</SelectItem>
                          <SelectItem value="4">4</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="seed">{t('seed')}</Label>
                    <Input id="seed" type="number" value={state.seed || ''} onChange={(e) => state.setField('seed', e.target.value ? Number(e.target.value) : undefined)} placeholder="e.g. 12345" />
                  </div>
                </CardContent>
              </Card>
            </div>
            <div className="mt-auto sticky bottom-0 py-4 bg-background">
              <Button size="lg" className="w-full h-12 text-lg" onClick={handleGenerate} disabled={state.isLoading}>
                {state.isLoading ? <Loader2 className="mr-2 h-6 w-6 animate-spin" /> : <Sparkles className="mr-2 h-5 w-5" />}
                {t('generate')}
              </Button>
            </div>
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>{t('results')}</CardTitle>
                  {selectedJob && <Button variant="outline" onClick={state.reset}>{t('newGeneration')}</Button>}
                </div>
              </CardHeader>
              <CardContent>
                {state.isLoading ? (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <Loader2 className="h-12 w-12 animate-spin" />
                    <p className="mt-4">Generating your vision...</p>
                  </div>
                ) : selectedJob?.final_result?.images ? (
                  <div className="space-y-4">
                    {state.finalPromptUsed && (
                      <Accordion type="single" collapsible>
                        <AccordionItem value="item-1">
                          <AccordionTrigger>{t('finalPromptUsed')}</AccordionTrigger>
                          <AccordionContent>
                            <p className="text-sm p-2 bg-muted rounded-md">{state.finalPromptUsed}</p>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      {selectedJob.final_result.images.map((image: any, index: number) => (
                        <div key={index} className="relative group">
                          <button onClick={() => showImage({ images: selectedJob.final_result.images.map((img: any) => ({ url: img.publicUrl, jobId: selectedJob.id })), currentIndex: index })}>
                            <img src={image.publicUrl} alt={`Generated image ${index + 1}`} className="rounded-md w-full" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                    <ImageIcon className="h-12 w-12" />
                    <p className="mt-4">{t('resultsPlaceholder')}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>{t('recentGenerations')}</CardTitle></CardHeader>
              <CardContent>
                {state.isFetchingJobs ? <Skeleton className="h-24 w-full" /> : state.recentJobs.length > 0 ? (
                  <Carousel opts={{ align: "start" }} className="w-full">
                    <CarouselContent className="-ml-4">
                      {state.recentJobs.map(job => (
                        <CarouselItem key={job.id} className="pl-4 basis-auto">
                          <GeneratorJobThumbnail
                            job={job}
                            onClick={() => state.selectJob(job)}
                            isSelected={state.selectedJobId === job.id}
                          />
                        </CarouselItem>
                      ))}
                    </CarouselContent>
                    <CarouselPrevious />
                    <CarouselNext />
                  </Carousel>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('noRecentJobs')}</p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Generator;