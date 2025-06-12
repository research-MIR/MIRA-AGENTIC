import { Label } from "@/components/ui/label";
import { ModelSelector } from "@/components/ModelSelector";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/context/LanguageContext";

interface ControlPanelProps {
  selectedModelId: string | null;
  onModelChange: (modelId: string) => void;
  isDesignerMode: boolean;
  onDesignerModeChange: (value: boolean) => void;
  pipelineMode: 'auto' | 'on' | 'off';
  onPipelineModeChange: (value: 'auto' | 'on' | 'off') => void;
  ratioMode: 'auto' | string;
  onRatioModeChange: (value: 'auto' | string) => void;
  numImagesMode: 'auto' | number;
  onNumImagesModeChange: (value: 'auto' | number) => void;
  isJobActive: boolean;
}

export const ControlPanel = ({
  selectedModelId,
  onModelChange,
  isDesignerMode,
  onDesignerModeChange,
  pipelineMode,
  onPipelineModeChange,
  ratioMode,
  onRatioModeChange,
  numImagesMode,
  onNumImagesModeChange,
  isJobActive,
}: ControlPanelProps) => {
  const { t } = useLanguage();

  return (
    <div className="p-2 border-b">
      <div className="flex flex-wrap items-center gap-4">
        <div id="model-selector">
          <ModelSelector selectedModelId={selectedModelId} onModelChange={onModelChange} disabled={isJobActive} />
        </div>
        <div id="designer-mode-switch" className="flex items-center space-x-2">
          <Switch id="designer-mode" checked={isDesignerMode} onCheckedChange={onDesignerModeChange} />
          <Label htmlFor="designer-mode">{t.designerMode}</Label>
        </div>
        <div id="pipeline-mode-select" className="flex items-center gap-2">
          <Label className="text-sm font-medium">Pipeline:</Label>
          <Select value={pipelineMode} onValueChange={(v) => onPipelineModeChange(v as any)}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="on">On</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div id="ratio-mode-select" className="flex items-center gap-2">
          <Label className="text-sm font-medium">Ratio:</Label>
          <Select value={ratioMode} onValueChange={onRatioModeChange}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              <SelectItem value="1:1">1:1</SelectItem>
              <SelectItem value="16:9">16:9</SelectItem>
              <SelectItem value="9:16">9:16</SelectItem>
              <SelectItem value="4:3">4:3</SelectItem>
              <SelectItem value="3:4">3:4</SelectItem>
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
      </div>
    </div>
  );
};