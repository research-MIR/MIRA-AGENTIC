import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { AdjustmentLayer, HueSaturationSettings, LevelsSettings, CurvesSettings } from "@/types/editor";
import { useLanguage } from "@/context/LanguageContext";

interface AdjustmentPanelProps {
  selectedLayer?: AdjustmentLayer;
  onUpdateLayer: (id: string, newSettings: any) => void;
}

const HueSaturationControls = ({ settings, onUpdate }: { settings: HueSaturationSettings, onUpdate: (newSettings: Partial<HueSaturationSettings>) => void }) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <div>
        <Label>{t.hue}</Label>
        <Slider value={[settings.hue]} onValueChange={(v) => onUpdate({ hue: v[0] })} min={-180} max={180} step={1} />
        <p className="text-xs text-center text-muted-foreground">{settings.hue}</p>
      </div>
      <div>
        <Label>{t.saturation}</Label>
        <Slider value={[settings.saturation * 100]} onValueChange={(v) => onUpdate({ saturation: v[0] / 100 })} min={0} max={200} step={1} />
        <p className="text-xs text-center text-muted-foreground">{(settings.saturation * 100 - 100).toFixed(0)}%</p>
      </div>
      <div>
        <Label>{t.lightness}</Label>
        <Slider value={[settings.lightness * 100]} onValueChange={(v) => onUpdate({ lightness: v[0] / 100 })} min={-100} max={100} step={1} />
        <p className="text-xs text-center text-muted-foreground">{(settings.lightness * 100).toFixed(0)}%</p>
      </div>
    </div>
  );
};

const LevelsControls = ({ settings, onUpdate }: { settings: LevelsSettings, onUpdate: (newSettings: Partial<LevelsSettings>) => void }) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <div>
        <Label>{t.inputLevels}</Label>
        {/* Placeholder for histogram */}
        <div className="h-24 bg-muted rounded-md my-2 flex items-center justify-center text-sm text-muted-foreground">{t.preview}</div>
        <div className="flex justify-between text-xs">
          <span>{t.shadows}</span>
          <span>{t.midtones}</span>
          <span>{t.highlights}</span>
        </div>
      </div>
      <div>
        <Label>{t.outputLevels}</Label>
        <div className="h-8 bg-gradient-to-r from-black to-white rounded-md my-2"></div>
      </div>
    </div>
  );
};

const CurvesControls = ({ settings, onUpdate }: { settings: CurvesSettings, onUpdate: (newSettings: Partial<CurvesSettings>) => void }) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <div>
        <Label>{t.curves}</Label>
        {/* Placeholder for curves graph */}
        <div className="aspect-square bg-muted rounded-md my-2 flex items-center justify-center text-sm text-muted-foreground">{t.preview}</div>
      </div>
    </div>
  );
};

export const AdjustmentPanel = ({ selectedLayer, onUpdateLayer }: AdjustmentPanelProps) => {
  const { t } = useLanguage();

  if (!selectedLayer) {
    return (
      <Card>
        <CardHeader><CardTitle>{t.adjustments}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{t.selectLayerToEdit}</p>
        </CardContent>
      </Card>
    );
  }

  const renderControls = () => {
    const handleUpdate = (newSettings: any) => {
      onUpdateLayer(selectedLayer.id, newSettings);
    };

    switch (selectedLayer.type) {
      case 'hue-saturation':
        return <HueSaturationControls settings={selectedLayer.settings as HueSaturationSettings} onUpdate={handleUpdate} />;
      case 'levels':
        return <LevelsControls settings={selectedLayer.settings as LevelsSettings} onUpdate={handleUpdate} />;
      case 'curves':
        return <CurvesControls settings={selectedLayer.settings as CurvesSettings} onUpdate={handleUpdate} />;
      default:
        return <p className="text-sm text-muted-foreground">{t.noControls}</p>;
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>{selectedLayer.name}</CardTitle></CardHeader>
      <CardContent>
        {renderControls()}
      </CardContent>
    </Card>
  );
};