import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { useLanguage } from "@/context/LanguageContext";

interface InpaintingSettingsProps {
  denoise: number;
  setDenoise: (d: number) => void;
  styleStrength: number;
  setStyleStrength: (s: number) => void;
  disabled: boolean;
}

export const InpaintingSettings = ({
  denoise,
  setDenoise,
  styleStrength,
  setStyleStrength,
  disabled,
}: InpaintingSettingsProps) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      <div>
        <Label>Denoise Strength: {denoise.toFixed(2)}</Label>
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
        <Label>Style Strength: {styleStrength.toFixed(2)}</Label>
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