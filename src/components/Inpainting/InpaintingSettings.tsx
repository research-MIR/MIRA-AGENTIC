import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/context/LanguageContext";

interface InpaintingSettingsProps {
  styleStrength: number;
  setStyleStrength: (s: number) => void;
  maskExpansion: number;
  setMaskExpansion: (me: number) => void;
  disabled: boolean;
}

export const InpaintingSettings = ({
  styleStrength,
  setStyleStrength,
  maskExpansion,
  setMaskExpansion,
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