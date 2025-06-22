import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Brush, RotateCcw } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

interface MaskControlsProps {
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
  onReset: () => void;
}

export const MaskControls = ({ brushSize, onBrushSizeChange, onReset }: MaskControlsProps) => {
  const { t } = useLanguage();
  return (
    <div className="p-2 bg-background/80 backdrop-blur-sm rounded-lg shadow-lg flex items-center gap-4">
      <div className="flex items-center gap-2">
        <Brush className="h-5 w-5" />
        <Slider
          value={[brushSize]}
          onValueChange={(v) => onBrushSizeChange(v[0])}
          min={1}
          max={100}
          step={1}
          className="w-32"
        />
      </div>
      <Button variant="outline" size="icon" onClick={onReset} title={t('resetMask')}>
        <RotateCcw className="h-4 w-4" />
      </Button>
    </div>
  );
};