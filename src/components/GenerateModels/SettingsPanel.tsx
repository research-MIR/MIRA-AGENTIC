import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ModelSelector } from "@/components/ModelSelector";
import { Model } from "@/hooks/useChatManager";
import { useLanguage } from "@/context/LanguageContext";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
}

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
}: SettingsPanelProps) => {
  const { t } = useLanguage();

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
          <Label htmlFor="set-description">{t('setDescription')}</Label>
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