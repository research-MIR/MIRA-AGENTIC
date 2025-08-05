import { Label } from "@/components/ui/label";
import { ModelSelector } from "@/components/ModelSelector";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/context/LanguageContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { Model } from "@/hooks/useChatManager";

interface ControlPanelProps {
  models: Model[];
  selectedModelId: string | null;
  onModelChange: (modelId: string) => void;
  isDesignerMode: boolean;
  onDesignerModeChange: (value: boolean) => void;
  ratioMode: 'auto' | string;
  onRatioModeChange: (value: 'auto' | string) => void;
  numImagesMode: 'auto' | number;
  onNumImagesModeChange: (value: 'auto' | number) => void;
  isJobActive: boolean;
}

const modelAspectRatioMap: Record<string, string[]> = {
    google: ['1024x1024', '768x1408', '1408x768', '1280x896', '896x1280'],
    'fal.ai': ['square_hd', 'square', 'portrait_4_3', 'portrait_16_9', 'landscape_4_3', 'landscape_16_9'],
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
};

export const ControlPanel = ({
  models,
  selectedModelId,
  onModelChange,
  isDesignerMode,
  onDesignerModeChange,
  ratioMode,
  onRatioModeChange,
  numImagesMode,
  onNumImagesModeChange,
  isJobActive,
}: ControlPanelProps) => {
  const { t } = useLanguage();

  const selectedModel = models.find(m => m.model_id_string === selectedModelId);
  const provider = selectedModel?.provider.toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'google';
  const validRatios = modelAspectRatioMap[provider] || modelAspectRatioMap.google;

  return (
    <div className="p-2 border-b">
      <div className="flex flex-wrap items-center gap-4">
        <div id="model-selector">
          <ModelSelector models={models} selectedModelId={selectedModelId} onModelChange={onModelChange} disabled={isJobActive} />
        </div>
        <div id="designer-mode-switch" className="flex items-center space-x-2">
          <Switch id="designer-mode" checked={isDesignerMode} onCheckedChange={onDesignerModeChange} />
          <Label htmlFor="designer-mode">{t('designerMode')}</Label>
        </div>
        <div id="ratio-mode-select" className="flex items-center gap-2">
          <Label className="text-sm font-medium">Ratio:</Label>
          <Select value={ratioMode} onValueChange={onRatioModeChange}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              {validRatios.map(ratio => <SelectItem key={ratio} value={ratio}>{resolutionToRatioMap[ratio] || ratio}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div id="num-images-select" className="flex items-center gap-2">
          <Label className="text-sm font-medium">Images:</Label>
          <Select value={String(numImagesMode)} onValueChange={(v) => onNumImagesModeChange(v === 'auto' ? 'auto' : Number(v))}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="1">1</SelectItem>
              <SelectItem value="2">2</SelectItem>
              <SelectItem value="4">4</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('refinerSuggestion')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};