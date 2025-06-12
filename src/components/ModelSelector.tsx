import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { showError } from "@/utils/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface Model {
  id: string;
  model_id_string: string;
  provider: string;
  is_default: boolean;
  supports_img2img: boolean;
}

interface ModelSelectorProps {
  selectedModelId: string | null;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export const ModelSelector = ({ selectedModelId, onModelChange, disabled = false }: ModelSelectorProps) => {
  const [models, setModels] = useState<Model[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const { data, error } = await supabase
          .from("mira-agent-models")
          .select("id, model_id_string, provider, is_default, supports_img2img")
          .eq("model_type", "image")
          .not('provider', 'eq', 'OpenAI');

        if (error) throw error;

        if (data) {
          setModels(data);
          const defaultModel = data.find(m => m.is_default);
          if (defaultModel) {
            setDefaultModelId(defaultModel.model_id_string);
            if (!selectedModelId) {
              onModelChange(defaultModel.model_id_string);
            }
          }
        }
      } catch (error: any) {
        showError("Failed to load image models: " + error.message);
      }
    };

    fetchModels();
  }, [onModelChange, selectedModelId]);

  const currentSelection = selectedModelId || defaultModelId;

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
                    <span>{model.model_id_string}</span>
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