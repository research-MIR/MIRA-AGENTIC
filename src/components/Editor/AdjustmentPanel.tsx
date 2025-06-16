import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { AdjustmentLayer, HSLAdjustment } from "@/types/editor";
import { useLanguage } from "@/context/LanguageContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface AdjustmentPanelProps {
  selectedLayer?: AdjustmentLayer;
  onUpdateLayer: (id: string, newSettings: any) => void;
}

const HSLControls = ({ layer, onUpdateLayer }: { layer: AdjustmentLayer, onUpdateLayer: (id: string, newSettings: any) => void }) => {
  const [activeChannel, setActiveChannel] = useState<HSLAdjustment['range']>('master');
  const settings = layer.settings as HSLAdjustment[];
  const currentSetting = settings.find(s => s.range === activeChannel)!;

  const handleSettingChange = (key: 'hue' | 'saturation' | 'lightness', value: number) => {
    const newSettings = settings.map(s => 
      s.range === activeChannel ? { ...s, [key]: value } : s
    );
    onUpdateLayer(layer.id, newSettings);
  };

  const colorRanges: HSLAdjustment['range'][] = ['master', 'reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas'];
  const colorClasses: Record<HSLAdjustment['range'], string> = {
    master: 'bg-gray-400',
    reds: 'bg-red-500',
    yellows: 'bg-yellow-500',
    greens: 'bg-green-500',
    cyans: 'bg-cyan-500',
    blues: 'bg-blue-500',
    magentas: 'bg-fuchsia-500',
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-1">
        {colorRanges.map(range => (
          <button 
            key={range} 
            onClick={() => setActiveChannel(range)}
            className={cn(
              "w-8 h-8 rounded-full border-2 transition-all",
              activeChannel === range ? 'border-primary scale-110' : 'border-transparent hover:border-muted-foreground'
            )}
          >
            <div className={cn("w-full h-full rounded-full", colorClasses[range])} />
          </button>
        ))}
      </div>
      <div>
        <Label>Hue</Label>
        <Slider value={[currentSetting.hue]} onValueChange={v => handleSettingChange('hue', v[0])} min={-180} max={180} step={1} />
        <p className="text-xs text-center text-muted-foreground">{currentSetting.hue}</p>
      </div>
      <div>
        <Label>Saturation</Label>
        <Slider value={[currentSetting.saturation]} onValueChange={v => handleSettingChange('saturation', v[0])} min={-100} max={100} step={1} />
        <p className="text-xs text-center text-muted-foreground">{currentSetting.saturation}</p>
      </div>
      <div>
        <Label>Lightness</Label>
        <Slider value={[currentSetting.lightness]} onValueChange={v => handleSettingChange('lightness', v[0])} min={-100} max={100} step={1} />
        <p className="text-xs text-center text-muted-foreground">{currentSetting.lightness}</p>
      </div>
    </div>
  );
};

const LevelsControls = ({ layer, onUpdateLayer }: { layer: AdjustmentLayer, onUpdateLayer: (id: string, newSettings: any) => void }) => {
  const settings = layer.settings as any;
  const handleSettingChange = (key: string, value: number) => {
    onUpdateLayer(layer.id, { ...settings, [key]: value });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>Input Black</Label>
        <Slider value={[settings.inBlack]} onValueChange={v => handleSettingChange('inBlack', v[0])} min={0} max={254} step={1} />
      </div>
      <div>
        <Label>Input White</Label>
        <Slider value={[settings.inWhite]} onValueChange={v => handleSettingChange('inWhite', v[0])} min={settings.inBlack + 1} max={255} step={1} />
      </div>
      <div>
        <Label>Gamma</Label>
        <Slider value={[settings.inGamma]} onValueChange={v => handleSettingChange('inGamma', v[0])} min={0.1} max={10} step={0.01} />
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
    switch (selectedLayer.type) {
      case 'hsl':
        return <HSLControls layer={selectedLayer} onUpdateLayer={onUpdateLayer} />;
      case 'levels':
        return <LevelsControls layer={selectedLayer} onUpdateLayer={onUpdateLayer} />;
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