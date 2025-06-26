import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Wand2, Sparkles, Loader2, Image as ImageIcon, X, PlusCircle, Shirt, Palette, HelpCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { InpaintingSettings } from "../Inpainting/InpaintingSettings";
import { useLanguage } from "@/context/LanguageContext";
import { Input } from "@/components/ui/input";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BitStudioJob } from '@/types/vto';
import { SecureImageDisplay } from './SecureImageDisplay';

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear, icon }: { onFileSelect: (file: File) => void, title: string, imageUrl: string | null, onClear: () => void, icon: React.ReactNode }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files[0]) });
  
    if (imageUrl) {
      return (
        <div className="relative h-32">
          <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}><X className="h-4 w-4" /></Button>
        </div>
      );
    }
  
    return (
      <div {...dropzoneProps} className={cn("flex flex-col h-32 justify-center items-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        <div className="text-center pointer-events-none">{icon}<p className="mt-2 text-sm font-semibold">{title}</p></div>
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files[0])} />
      </div>
    );
};

interface VTOProSetupProps {
    selectedJob: BitStudioJob | undefined;
    resetForm: () => void;
    sourceImageFile: File | null;
    referenceImageFile: File | null;
    onSourceFileSelect: (file: File | null) => void;
    onReferenceFileSelect: (file: File | null) => void;
    prompt: string;
    setPrompt: (p: string) => void;
    isAutoPromptEnabled: boolean;
    setIsAutoPromptEnabled: (e: boolean) => void;
    numAttempts: number;
    setNumAttempts: (n: number) => void;
    maskExpansion: number;
    setMaskExpansion: (m: number) => void;
    isLoading: boolean;
    onGenerate: () => void;
    isGenerateDisabled: boolean;
    onGuideOpen: () => void;
    resolution: 'standard' | 'high';
    setResolution: (res: 'standard' | 'high') => void;
}

export const VTOProSetup = ({
    selectedJob, resetForm, sourceImageFile, referenceImageFile, onSourceFileSelect, onReferenceFileSelect,
    prompt, setPrompt, isAutoPromptEnabled, setIsAutoPromptEnabled,
    numAttempts, setNumAttempts, maskExpansion, setMaskExpansion,
    isLoading, onGenerate, isGenerateDisabled, onGuideOpen,
    resolution, setResolution
}: VTOProSetupProps) => {
    const { t } = useLanguage();
    const sourceImageUrl = useMemo(() => sourceImageFile ? URL.createObjectURL(sourceImageFile) : null, [sourceImageFile]);
    const referenceImageUrl = useMemo(() => referenceImageFile ? URL.createObjectURL(referenceImageFile) : null, [referenceImageFile]);

    const placeholderText = isAutoPromptEnabled ? t('promptPlaceholderVTO') : t('promptPlaceholderVTO');

    return (
        <div className="lg:col-span-1 flex flex-col gap-4">
            <div className="space-y-4">
                <Card>
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <CardTitle>{selectedJob ? t('selectedJob') : t('setup')}</CardTitle>
                            <div className="flex items-center gap-2">
                                <Button variant="ghost" size="icon" onClick={onGuideOpen}>
                                    <HelpCircle className="h-5 w-5" />
                                </Button>
                                {(selectedJob || sourceImageFile) && <Button variant="outline" size="sm" onClick={resetForm}><PlusCircle className="h-4 w-4 mr-2" />{t('new')}</Button>}
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {selectedJob ? (
                            <div className="space-y-4">
                                <p className="text-sm text-muted-foreground">{t('viewingJob')}</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label>{t('sourceImage')}</Label>
                                        <div className="mt-1 aspect-square w-full bg-muted rounded-md overflow-hidden">
                                            <SecureImageDisplay imageUrl={selectedJob.metadata?.source_image_url || null} alt="Source Person" />
                                        </div>
                                    </div>
                                    <div>
                                        <Label>{t('referenceImage')}</Label>
                                        <div className="mt-1 aspect-square w-full bg-muted rounded-md overflow-hidden">
                                            <SecureImageDisplay imageUrl={selectedJob.metadata?.reference_image_url || null} alt="Source Garment" />
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <Label>{t('prompt')}</Label>
                                    <p className="text-sm p-2 bg-muted rounded-md mt-1">{selectedJob.metadata?.prompt_used || "N/A"}</p>
                                </div>
                            </div>
                        ) : (
                            <Accordion type="multiple" defaultValue={['item-1']} className="w-full">
                                <AccordionItem value="item-1">
                                    <AccordionTrigger>{t('uploadImages')}</AccordionTrigger>
                                    <AccordionContent className="pt-4 space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <ImageUploader onFileSelect={onSourceFileSelect} title={t('sourceImage')} imageUrl={sourceImageUrl} onClear={resetForm} icon={<ImageIcon className="h-8 w-8 text-muted-foreground" />} />
                                            <ImageUploader onFileSelect={onReferenceFileSelect} title={t('referenceImage')} imageUrl={referenceImageUrl} onClear={() => onReferenceFileSelect(null)} icon={<Shirt className="h-8 w-8 text-muted-foreground" />} />
                                        </div>
                                    </AccordionContent>
                                </AccordionItem>
                                <AccordionItem value="item-2">
                                    <AccordionTrigger>{t('promptOptional')}</AccordionTrigger>
                                    <AccordionContent className="pt-4 space-y-2">
                                        <div className="flex items-center space-x-2">
                                            <Switch id="auto-prompt-pro" checked={isAutoPromptEnabled} onCheckedChange={setIsAutoPromptEnabled} />
                                            <Label htmlFor="auto-prompt-pro">{t('autoGenerate')}</Label>
                                        </div>
                                        <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={placeholderText} rows={4} disabled={isAutoPromptEnabled} />
                                    </AccordionContent>
                                </AccordionItem>
                                <AccordionItem value="item-3">
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <AccordionTrigger className="text-primary animate-pulse">{t('proSettings')}</AccordionTrigger>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                                <p>{t('proSettingsTooltip')}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                    <AccordionContent className="pt-4">
                                        <InpaintingSettings
                                            numAttempts={numAttempts} setNumAttempts={setNumAttempts}
                                            maskExpansion={maskExpansion} setMaskExpansion={setMaskExpansion}
                                            disabled={isLoading}
                                            resolution={resolution}
                                            setResolution={setResolution}
                                        />
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        )}
                    </CardContent>
                </Card>
                <Button size="lg" className="w-full" onClick={onGenerate} disabled={isGenerateDisabled}>
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                    {t('generate')}
                </Button>
            </div>
        </div>
    );
};