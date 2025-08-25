import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ModelSelector } from "@/components/ModelSelector";
import { Model } from "@/hooks/useChatManager";
import { useLanguage } from "@/context/LanguageContext";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface SettingsPanelProps {
  upperBodyModels: string;
  setUpperBodyModels: (value: string) => void;
  lowerBodyModels: string;
  setLowerBodyModels: (value: string) => void;
  fullBodyModels: string;
  setFullBodyModels: (value: string) => void;
  setDescription: string;
  setSetDescription: (value: string) => void;
  models: Model[];
  selectedModelId: string | null;
  setSelectedModelId: (id: string) => void;
  isJobActive: boolean;
  aspectRatio: string;
  setAspectRatio: (value: string) => void;
  engine: string;
  setEngine: (engine: 'comfyui' | 'fal_kontext') => void;
}

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

export const SettingsPanel = ({
  upperBodyModels,
  setUpperBodyModels,
  lowerBodyModels,
  setLowerBodyModels,
  fullBodyModels,
  setFullBodyModels,
  setDescription,
  setSetDescription,
  models,
  selectedModelId,
  setSelectedModelId,
  isJobActive,
  aspectRatio,
  setAspectRatio,
  engine,
  setEngine,
}: SettingsPanelProps) => {
  const { t } = useLanguage();
  const selectedModel = models.find(m => m.model_id_string === selectedModelId);
  const provider = selectedModel?.provider.toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'google';
  const validRatios = modelAspectRatioMap[provider] || modelAspectRatioMap.google;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('step1')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Accordion type="multiple" defaultValue={['item-1']} className="w-full">
          <AccordionItem value="item-1">
            <AccordionTrigger className="text-base font-semibold">Model Descriptions</AccordionTrigger>
            <AccordionContent className="pt-4 space-y-4">
              <div>
                <Label htmlFor="upper-body-models">Upper Body Models</Label>
                <Textarea
                  id="upper-body-models"
                  value={upperBodyModels}
                  onChange={(e) => setUpperBodyModels(e.target.value)}
                  placeholder="e.g., a tall female model with blonde hair, a male model with a beard..."
                  rows={3}
                  disabled={isJobActive}
                />
              </div>
              <div>
                <Label htmlFor="lower-body-models">Lower Body Models</Label>
                <Textarea
                  id="lower-body-models"
                  value={lowerBodyModels}
                  onChange={(e) => setLowerBodyModels(e.target.value)}
                  placeholder="e.g., a curvy model, a very slim model..."
                  rows={3}
                  disabled={isJobActive}
                />
              </div>
              <div>
                <Label htmlFor="full-body-models">Full Body Models</Label>
                <Textarea
                  id="full-body-models"
                  value={fullBodyModels}
                  onChange={(e) => setFullBodyModels(e.target.value)}
                  placeholder="e.g., an athletic model in a dynamic pose..."
                  rows={3}
                  disabled={isJobActive}
                />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="set-description">{t('setDescription')}</Label>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Badge variant="outline">{t('default')}</Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t('defaultDescription')}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Textarea
            id="set-description"
            value={setDescription}
            onChange={(e) => setSetDescription(e.target.value)}
            placeholder={t('setDescriptionPlaceholder')}
            rows={2}
            disabled={isJobActive}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('baseModel')}</Label>
          <ModelSelector
            models={models as Model[]}
            selectedModelId={selectedModelId}
            onModelChange={setSelectedModelId}
            disabled={isJobActive}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('engine')}</Label>
          <Select value={engine} onValueChange={(v) => setEngine(v as 'comfyui' | 'fal_kontext')} disabled={isJobActive}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="comfyui">{t('engineComfyUI')}</SelectItem>
              <SelectItem value="fal_kontext">{t('engineFalKontext')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
            <Label>{t('aspectRatio')}</Label>
            <Select value={validRatios.includes(aspectRatio) ? aspectRatio : ''} onValueChange={setAspectRatio} disabled={isJobActive}>
                <SelectTrigger><SelectValue placeholder="Select or type custom..." /></SelectTrigger>
                <SelectContent>
                    {validRatios.map(option => (
                        <SelectItem key={option} value={option}>{resolutionToRatioMap[option] || option}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {provider === 'fal.ai' && (
                <Input 
                    className="mt-2"
                    placeholder="Or type custom ratio e.g., 21:9"
                    value={!validRatios.includes(aspectRatio) ? aspectRatio : ''}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    disabled={isJobActive}
                />
            )}
        </div>
      </CardContent>
    </Card>
  );
};