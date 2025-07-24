import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info, Loader2, Shirt, Users } from 'lucide-react';
import { ModelPoseSelector, VtoModel, ModelPack } from '../ModelPoseSelector';
import { GarmentSelector } from '../GarmentSelector';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useLanguage } from "@/context/LanguageContext";

const MultiImageUploader = ({ onFilesSelect, title, icon, description }: { onFilesSelect: (files: File[]) => void, title: string, icon: React.ReactNode, description: string }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const { useDropzone } = require('@/hooks/useDropzone');
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e: React.DragEvent<HTMLElement>) => e.dataTransfer.files && onFilesSelect(Array.from(e.dataTransfer.files)) });
    const { cn } = require('@/lib/utils');
    const { Input } = require('@/components/ui/input');

    return (
      <div {...dropzoneProps} className={cn("flex flex-col h-full justify-center items-center rounded-lg border border-dashed p-2 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        {React.cloneElement(icon as React.ReactElement, { className: "h-6 w-6 text-muted-foreground" })}
        <p className="mt-1 text-xs font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Input ref={inputRef} type="file" multiple className="hidden" accept="image/*" onChange={(e: React.ChangeEvent<HTMLInputElement>) => e.target.files && onFilesSelect(Array.from(e.target.files))} />
      </div>
    );
};

interface RandomPairsInputsProps {
  models: VtoModel[];
  packs: ModelPack[] | undefined;
  isLoadingModels: boolean;
  isLoadingPacks: boolean;
  selectedPackId: string;
  setSelectedPackId: (id: string) => void;
  selectedModelUrls: Set<string>;
  handleUseEntirePack: (models: VtoModel[]) => void;
  setIsModelModalOpen: (isOpen: boolean) => void;
  analyzedRandomGarments: any[];
  handleRandomGarmentFilesSelect: (files: File[]) => void;
  handleSelectFromWardrobe: (garments: any[]) => void;
  generalAppendix: string;
  setGeneralAppendix: (appendix: string) => void;
  loopModels: boolean;
  setLoopModels: (loop: boolean) => void;
}

export const RandomPairsInputs = ({
  models,
  packs,
  isLoadingModels,
  isLoadingPacks,
  selectedPackId,
  setSelectedPackId,
  selectedModelUrls,
  handleUseEntirePack,
  setIsModelModalOpen,
  analyzedRandomGarments,
  handleRandomGarmentFilesSelect,
  handleSelectFromWardrobe,
  generalAppendix,
  setGeneralAppendix,
  loopModels,
  setLoopModels,
}: RandomPairsInputsProps) => {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('randomPairsInputTitle')}</CardTitle>
        <CardDescription>{t('randomPairsInputDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>{t('selectModels')}</Label>
            <Button variant="outline" className="w-full" onClick={() => setIsModelModalOpen(true)}>
              {t('selectModels')} ({selectedModelUrls.size})
            </Button>
            <ModelPoseSelector mode="get-all" onUseEntirePack={handleUseEntirePack} models={models || []} isLoading={isLoadingModels} error={null} packs={packs} isLoadingPacks={isLoadingPacks} selectedPackId={selectedPackId} setSelectedPackId={setSelectedPackId} />
          </div>
          <div className="space-y-2">
            <Label>{t('uploadGarments')}</Label>
            <GarmentSelector onSelect={handleSelectFromWardrobe} multiSelect={true}>
              <div className="h-32">
                <MultiImageUploader onFilesSelect={handleRandomGarmentFilesSelect} title={t('uploadGarments')} icon={<Shirt />} description={t('selectMultipleGarmentImages')} />
              </div>
            </GarmentSelector>
            {analyzedRandomGarments.length > 0 && (
              <ScrollArea className="h-24 mt-2 border rounded-md p-2">
                <div className="grid grid-cols-5 gap-2">
                  {analyzedRandomGarments.map((g, i) => <div key={i} className="relative"><img src={g.previewUrl} className="w-full h-full object-cover rounded-md aspect-square" />{g.isAnalyzing && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-white"/></div>}</div>)}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>
         <div>
          <Label htmlFor="general-appendix-random">{t('promptAppendix')}</Label>
          <Textarea id="general-appendix-random" value={generalAppendix} onChange={(e) => setGeneralAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
        </div>
        <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
            <div className="flex items-center gap-2">
                <Label htmlFor="loop-models-switch" className="text-sm font-medium">
                    {t('loopModels')}
                </Label>
                <TooltipProvider>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="max-w-xs">{t('loopModelsDescription')}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            </div>
            <Switch
                id="loop-models-switch"
                checked={loopModels}
                onCheckedChange={setLoopModels}
            />
        </div>
      </CardContent>
    </Card>
  );
};