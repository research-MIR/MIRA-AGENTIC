import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { ModelPoseSelector, VtoModel, ModelPack } from '../ModelPoseSelector';
import { GarmentSelector } from '../GarmentSelector';
import { useLanguage } from "@/context/LanguageContext";

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear }: { onFileSelect: (files: FileList) => void, title: string, imageUrl: string | null, onClear: () => void }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const { useDropzone } = require('@/hooks/useDropzone');
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e: React.DragEvent<HTMLElement>) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files) });
    const { cn } = require('@/lib/utils');
    const { PlusCircle } = require('lucide-react');
    const { Input } = require('@/components/ui/input');

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
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e: React.ChangeEvent<HTMLInputElement>) => e.target.files && onFileSelect(e.target.files)} />
      </div>
    );
};

interface OneToManyInputsProps {
  onQueueReady: (queue: any[]) => void;
  models: VtoModel[];
  packs: ModelPack[] | undefined;
  isLoadingModels: boolean;
  isLoadingPacks: boolean;
  selectedPackId: string;
  setSelectedPackId: (id: string) => void;
  selectedModelUrls: Set<string>;
  handleMultiModelSelect: (urls: string[]) => void;
  handleUseEntirePack: (models: VtoModel[]) => void;
  analyzedGarment: any;
  handleGarmentFileSelect: (files: FileList) => void;
  handleSelectFromWardrobe: (garments: any[]) => void;
  setAnalyzedGarment: (garment: any) => void;
  generalAppendix: string;
  setGeneralAppendix: (appendix: string) => void;
  setIsModelModalOpen: (isOpen: boolean) => void;
}

export const OneToManyInputs = ({
  models,
  packs,
  isLoadingModels,
  isLoadingPacks,
  selectedPackId,
  setSelectedPackId,
  selectedModelUrls,
  handleUseEntirePack,
  analyzedGarment,
  handleGarmentFileSelect,
  handleSelectFromWardrobe,
  setAnalyzedGarment,
  generalAppendix,
  setGeneralAppendix,
  setIsModelModalOpen,
}: OneToManyInputsProps) => {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('oneToManyInputTitle')}</CardTitle>
        <CardDescription>{t('oneToManyInputDescription')}</CardDescription>
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
            <Label>{t('uploadGarment')}</Label>
            <GarmentSelector onSelect={(garments) => handleSelectFromWardrobe(garments)} multiSelect={false}>
              <div className="aspect-square max-w-xs mx-auto relative">
                <ImageUploader onFileSelect={(files) => handleGarmentFileSelect(files)} title={t('garmentImage')} imageUrl={analyzedGarment?.previewUrl || null} onClear={() => setAnalyzedGarment(null)} />
                {analyzedGarment?.isAnalyzing && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-md">
                    <Loader2 className="h-8 w-8 animate-spin text-white" />
                  </div>
                )}
              </div>
            </GarmentSelector>
          </div>
        </div>
        <div>
          <Label htmlFor="general-appendix">{t('promptAppendix')}</Label>
          <Textarea id="general-appendix" value={generalAppendix} onChange={(e) => setGeneralAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
        </div>
      </CardContent>
    </Card>
  );
};