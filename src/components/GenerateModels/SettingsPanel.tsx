import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ModelSelector } from "@/components/ModelSelector";
import { Model } from "@/hooks/useChatManager";
import { useLanguage } from "@/context/LanguageContext";
import { Sparkles, Loader2 } from "lucide-react";

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
  onGenerate: () => void;
  isLoading: boolean;
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
  onGenerate,
  isLoading,
}: SettingsPanelProps) => {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('step1')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="model-description">{t('modelDescription')}</Label>
          <Textarea
            id="model-description"
            value={modelDescription}
            onChange={(e) => setModelDescription(e.target.value)}
            placeholder={t('modelDescriptionPlaceholder')}
            rows={3}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="set-description">{t('setDescripion')}</Label>
          <Textarea
            id="set-description"
            value={setDescription}
            onChange={(e) => setSetDescription(e.target.value)}
            placeholder={t('setDescriptionPlaceholder')}
            rows={2}
            disabled={isLoading}
          />
        </div>
        <div className="space-y-2">
          <Label>{t('baseModel')}</Label>
          <ModelSelector
            models={models}
            selectedModelId={selectedModelId}
            onModelChange={setSelectedModelId}
            disabled={isLoading}
          />
        </div>
        <div>
          <CardTitle className="text-lg mb-2">{t('step2')}</CardTitle>
          <div className="flex items-center space-x-2 p-3 rounded-md bg-muted/50">
            <Switch
              id="auto-approve"
              checked={autoApprove}
              onCheckedChange={setAutoApprove}
              disabled={isLoading}
            />
            <div className="grid gap-1.5 leading-none">
                <Label htmlFor="auto-approve">{t('autoApprove')}</Label>
                <p className="text-xs text-muted-foreground">{t('autoApproveDescription')}</p>
            </div>
          </div>
        </div>
        <Button size="lg" className="w-full" onClick={onGenerate} disabled={isLoading || !modelDescription.trim()}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          {t('generateButton')}
        </Button>
      </CardContent>
    </Card>
  );
};