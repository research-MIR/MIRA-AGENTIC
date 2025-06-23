import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useLanguage } from "@/context/LanguageContext";

interface InpaintingSettingsProps {
  styleStrength: number;
  setStyleStrength: (s: number) => void;
  disabled: boolean;
}

export const InpaintingSettings = ({
  styleStrength,
  setStyleStrength,
  disabled,
}: InpaintingSettingsProps) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <div>
        <Label>{t('styleStrength', { strength: styleStrength.toFixed(2) })}</Label>
        <Slider
          value={[styleStrength]}
          onValueChange={(v) => setStyleStrength(v[0])}
          min={0.0}
          max={1.0}
          step={0.01}
          disabled={disabled}
        />
      </div>
    </div>
  );
};