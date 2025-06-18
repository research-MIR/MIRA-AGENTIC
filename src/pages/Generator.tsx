import React, { useEffect } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const FileUploader = ({ onFileSelect, children, multiple = false }: { onFileSelect: (files: FileList | null) => void, children: React.ReactNode, multiple?: boolean }) => {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className="p-4 border-2 border-dashed rounded-lg text-center cursor-pointer hover:border-primary transition-colors" onClick={() => inputRef.current?.click()}>
      {children}
      <Input ref={inputRef} type="file" multiple={multiple} className="hidden" accept="image/*" onChange={(e) => onFileSelect(e.target.files)} />
    </div>
  );
};

const Generator = () => {
  const { session } = useSession();
  const { t } = useLanguage();
  const { showImage } = useImagePreview();
  const state = useGeneratorStore();

  useEffect(() => {
    if (session?.user) {
      state.fetchRecentJobs(session.user.id);
    }
  }, [session?.user, state.fetchRecentJobs]);

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

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b">
        <h1 className="text-3xl font-bold">{t('imageGenerator')}</h1>
        <p className="text-muted-foreground">{t('generatorDescription')}</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Controls */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          <div className="flex-grow">
            <Accordion type="multiple" defaultValue={['item-1', 'item-2']} className="w-full">
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
              <AccordionItem value="item-3">
                <AccordionTrigger className="text-base font-semibold">3. {t('configureSettings')}</AccordionTrigger>
                <AccordionContent className="pt-4 space-y-4">
                  <div>
                    <Label>{t('model')}</Label>
                    <ModelSelector selectedModelId={state.selectedModelId} onModelChange={(val) => state.setField('selectedModelId', val)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="aspect-ratio">{t('aspectRatio')}</Label>
                      <Select value={state.aspectRatio} onValueChange={(val) => state.setField('aspectRatio', val)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1024x1024">1:1</SelectItem>
                          <SelectItem value="1408x768">16:9</SelectItem>
                          <SelectItem value="768x1408">9:16</SelectItem>
                          <SelectItem value="1280x896">4:3</SelectItem>
                          <SelectItem value="896x1280">3:4</SelectItem>
                        </SelectContent>
                      </Select>
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
                </AccordionContent>
              </AccordionItem>
            </Accordion>
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
                <ScrollArea className="h-32">
                  <div className="flex gap-4 pb-2">
                    {state.recentJobs.map(job => (
                      <GeneratorJobThumbnail
                        key={job.id}
                        job={job}
                        onClick={() => state.selectJob(job)}
                        isSelected={state.selectedJobId === job.id}
                      />
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-muted-foreground">{t('noRecentJobs')}</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Generator;