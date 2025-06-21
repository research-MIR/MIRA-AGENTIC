import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/context/LanguageContext";

interface SingleTryOnSettingsProps {
  resolution: 'standard' | 'high';
  setResolution: (res: 'standard' | 'high') => void;
  numImages: number;
  setNumImages: (num: number) => void;
  disabled: boolean;
}

export const SingleTryOnSettings = ({ resolution, setResolution, numImages, setNumImages, disabled }: SingleTryOnSettingsProps) => {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>3. {t('settings')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="resolution-switch">{t('highResolution')}</Label>
          <Switch
            id="resolution-switch"
            checked={resolution === 'high'}
            onCheckedChange={(checked) => setResolution(checked ? 'high' : 'standard')}
            disabled={disabled}
          />
        </div>
        <div>
          <Label htmlFor="num-images-select">{t('numberOfImages')}</Label>
          <Select
            value={String(numImages)}
            onValueChange={(value) => setNumImages(Number(value))}
            disabled={disabled}
          >
            <SelectTrigger id="num-images-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map(num => (
                <SelectItem key={num} value={String(num)}>{num}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
};