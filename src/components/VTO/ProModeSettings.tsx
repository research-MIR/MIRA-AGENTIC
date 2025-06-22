import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useLanguage } from "@/context/LanguageContext";

interface ProModeSettingsProps {
  numAttempts: number;
  setNumAttempts: (n: number) => void;
  denoise: number;
  setDenoise: (d: number) => void;
  isHighQuality: boolean;
  setIsHighQuality: (hq: boolean) => void;
  maskExpansion: number;
  setMaskExpansion: (me: number) => void;
  disabled: boolean;
}

export const ProModeSettings = ({
  numAttempts,
  setNumAttempts,
  denoise,
  setDenoise,
  isHighQuality,
  setIsHighQuality,
  maskExpansion,
  setMaskExpansion,
  disabled,
}: ProModeSettingsProps) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="num-images-select">{t('numberOfImages')}</Label>
        <Select
          value={String(numAttempts)}
          onValueChange={(value) => setNumAttempts(Number(value))}
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
      <div className="flex items-center justify-between">
        <Label htmlFor="resolution-switch">{t('highResolution')}</Label>
        <Switch
          id="resolution-switch"
          checked={isHighQuality}
          onCheckedChange={setIsHighQuality}
          disabled={disabled}
        />
      </div>
      <div>
        <Label>{t('denoiseStrength', { denoise: denoise.toFixed(2) })}</Label>
        <Slider
          value={[denoise]}
          onValueChange={(v) => setDenoise(v[0])}
          min={0.1}
          max={1.0}
          step={0.01}
          disabled={disabled}
        />
      </div>
      <div>
        <Label>{t('maskExpansion', { maskExpansion })}</Label>
        <Slider
          value={[maskExpansion]}
          onValueChange={(v) => setMaskExpansion(v[0])}
          min={0}
          max={10}
          step={1}
          disabled={disabled}
        />
      </div>
    </div>
  );
};