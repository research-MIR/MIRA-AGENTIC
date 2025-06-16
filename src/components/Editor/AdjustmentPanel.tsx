import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { AdjustmentLayer } from "@/types/editor";
import { useLanguage } from "@/context/LanguageContext";

interface AdjustmentPanelProps {
  selectedLayer?: AdjustmentLayer;
  onUpdateLayer: (id: string, newSettings: any) => void;
}

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
    switch (selectedLayer.type) {
      case 'saturation':
        return (
          <div>
            <Label>{t.saturation}</Label>
            <Slider
              value={[selectedLayer.settings.saturation * 100]}
              onValueChange={(value) => onUpdateLayer(selectedLayer.id, { saturation: value[0] / 100 })}
              min={0}
              max={200}
              step={1}
            />
            <p className="text-xs text-center text-muted-foreground">{(selectedLayer.settings.saturation * 100).toFixed(0)}%</p>
          </div>
        );
      // Cases for 'curves', 'lut' etc. would go here
      default:
        return <p className="text-sm text-muted-foreground">{t.noControls}</p>;
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>{selectedLayer.name} {t.adjustments}</CardTitle></CardHeader>
      <CardContent>
        {renderControls()}
      </CardContent>
    </Card>
  );
};