import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { Model } from "@/hooks/useChatManager";

interface ModelSelectorProps {
  models: Model[];
  selectedModelId: string | null;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

const modelAliases: { [key: string]: string } = {
  'imagen-4': 'Photoreal Model',
  'imagen-4-ultra': 'Photoreal Model',
  'imagen-4.0-ultra-generate-exp-05-20': 'Photoreal Model',
  'fal-ai/flux-pro/v1.1-ultra': 'Creative Model',
  'fal-ai/flux-pro/v1.1-ultra/redux': 'Creative Model (Refined)',
  'fal-ai/bytedance/seedream/v3/text-to-image': 'Creative Model V3',
  'fal-ai/wan/v2.2-a14b/text-to-image': 'Creative Model V2.2',
};

export const ModelSelector = ({ models, selectedModelId, onModelChange, disabled = false }: ModelSelectorProps) => {
  if (!models || models.length === 0) {
    return (
      <Select disabled={true}>
        <SelectTrigger className="w-full md:w-[200px]">
          <SelectValue placeholder="Loading models..." />
        </SelectTrigger>
      </Select>
    );
  }
  
  const defaultModel = models.find(m => m.is_default);
  const currentSelection = selectedModelId || defaultModel?.model_id_string;

  const selector = (
    <Select onValueChange={onModelChange} value={currentSelection ?? undefined} disabled={disabled}>
      <SelectTrigger className="w-full md:w-[200px]">
        <SelectValue placeholder="Select a model..." />
      </SelectTrigger>
      <SelectContent>
        {models.map((model) => (
          <TooltipProvider key={model.id}>
            <Tooltip>
              <TooltipTrigger asChild>
                <SelectItem value={model.model_id_string}>
                  <div className="flex justify-between w-full items-center">
                    <span>{modelAliases[model.model_id_string] || model.model_id_string}</span>
                    {model.supports_img2img && <Badge variant="secondary">Ref</Badge>}
                  </div>
                </SelectItem>
              </TooltipTrigger>
              {model.supports_img2img && (
                <TooltipContent>
                  <p>This model supports image-to-image from a reference file.</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>
        ))}
      </SelectContent>
    </Select>
  );

  if (disabled) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-not-allowed">
              {selector}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>Il modello può essere scelto solo all'inizio di una nuova chat.</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return selector;
};