import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ModelSelector } from "@/components/ModelSelector";
import { Model } from "@/hooks/useChatManager";
import { useLanguage } from "@/context/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SettingsPanelProps {
  modelDescription: string;
  setModelDescription: (value: string) => void;
  setDescription: string;
  setSetDescription: (value: string) => void;
  models: Model[];
  selectedModelId: string | null;
  setSelectedModelId: (id: string) => void;
  autoApprove: boolean;
  setAutoApprove: (value: boolean) => void;
  isJobActive: boolean;
  activeTab: 'single' | 'multi';
  setActiveTab: (tab: 'single' | 'multi') => void;
  multiModelPrompt: string;
  setMultiModelPrompt: (value: string) => void;
  aspectRatio: string;
  setAspectRatio: (value: string) => void;
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

export const SettingsPanel = ({
  modelDescription,
  setModelDescription,
  setDescription,
  setSetDescription,
  models,
  selectedModelId,
  setSelectedModelId,
  autoApprove,
  setAutoApprove,
  isJobActive,
  activeTab,
  setActiveTab,
  multiModelPrompt,
  setMultiModelPrompt,
  aspectRatio,
  setAspectRatio,
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
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'single' | 'multi')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">{t('singleModel')}</TabsTrigger>
            <TabsTrigger value="multi">{t('multiModel')}</TabsTrigger>
          </TabsList>
          <TabsContent value="single" className="pt-4">
            <Label htmlFor="model-description">{t('modelDescription')}</Label>
            <Textarea
              id="model-description"
              value={modelDescription}
              onChange={(e) => setModelDescription(e.target.value)}
              placeholder={t('modelDescriptionPlaceholder')}
              rows={3}
              disabled={isJobActive}
            />
          </TabsContent>
          <TabsContent value="multi" className="pt-4">
            <Label htmlFor="multi-model-prompt">{t('multiModelDescription')}</Label>
            <Textarea
              id="multi-model-prompt"
              value={multiModelPrompt}
              onChange={(e) => setMultiModelPrompt(e.target.value)}
              placeholder={t('multiModelPlaceholder')}
              rows={5}
              disabled={isJobActive}
            />
          </TabsContent>
        </Tabs>

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
            models={models}
            selectedModelId={selectedModelId}
            onModelChange={setSelectedModelId}
            disabled={isJobActive}
          />
        </div>
        <div className="space-y-2">
            <Label>{t('aspectRatio')}</Label>
            <Select value={aspectRatio} onValueChange={setAspectRatio} disabled={isJobActive}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                    {validRatios.map(option => (
                        <SelectItem key={option} value={option}>{resolutionToRatioMap[option] || option}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
        {activeTab === 'single' && (
          <div>
            <h3 className="text-sm font-semibold mb-2">{t('step2')}</h3>
            <div className="flex items-center space-x-2 p-3 rounded-md bg-muted/50">
              <Switch
                id="auto-approve"
                checked={autoApprove}
                onCheckedChange={setAutoApprove}
                disabled={isJobActive}
              />
              <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="auto-approve">{t('autoApprove')}</Label>
                  <p className="text-xs text-muted-foreground">{t('autoApproveDescription')}</p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};