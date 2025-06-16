import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdjustmentLayer, HueSaturationSettings, LevelsSettings, CurvesSettings, NoiseSettings } from "@/types/editor";
import { useLanguage } from "@/context/LanguageContext";
import { useState, useRef, MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { RotateCcw, RefreshCw } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip";
import { Switch } from "../ui/switch";

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
        <div className="h-24 bg-muted rounded-md my-2 flex items-center justify-center text-sm text-muted-foreground relative p-2">
          <div className="w-full h-full bg-gradient-to-r from-black via-gray-500 to-white opacity-50"></div>
        </div>
        <div className="space-y-2">
            <Slider value={[settings.inputShadow, settings.inputHighlight]} onValueChange={(v) => onUpdate({ inputShadow: v[0], inputHighlight: v[1] })} min={0} max={255} step={1} />
            <Slider value={[settings.inputMidtone]} onValueChange={(v) => onUpdate({ inputMidtone: v[0] })} min={0.1} max={9.9} step={0.1} />
        </div>
      </div>
      <div>
        <Label>{t.outputLevels}</Label>
        <div className="h-8 bg-gradient-to-r from-black to-white rounded-md my-2"></div>
        <Slider value={[settings.outputShadow, settings.outputHighlight]} onValueChange={(v) => onUpdate({ outputShadow: v[0], outputHighlight: v[1] })} min={0} max={255} step={1} />
      </div>
    </div>
  );
};

const CurvesControls = ({ settings, onUpdate }: { settings: CurvesSettings, onUpdate: (newSettings: Partial<CurvesSettings>) => void }) => {
  const { t } = useLanguage();
  const graphRef = useRef<HTMLDivElement>(null);
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);

  const getCoords = (e: MouseEvent) => {
    if (!graphRef.current) return { x: 0, y: 0, isOutside: true };
    const rect = graphRef.current.getBoundingClientRect();
    const isOutside = e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom;
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    return { x: (x / rect.width) * 255, y: 255 - (y / rect.height) * 255, isOutside };
  };

  const handleMouseDown = (e: MouseEvent, index: number) => {
    e.preventDefault();
    setDraggingPointIndex(index);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (draggingPointIndex === null) return;
    const { x, y, isOutside } = getCoords(e);
    
    if (isOutside && draggingPointIndex > 0 && draggingPointIndex < settings.points.length - 1) {
        const newPoints = settings.points.filter((_, i) => i !== draggingPointIndex);
        onUpdate({ points: newPoints });
        setDraggingPointIndex(null);
        return;
    }

    const newPoints = [...settings.points];
    if (draggingPointIndex > 0 && draggingPointIndex < newPoints.length - 1) {
      newPoints[draggingPointIndex].x = x;
    }
    newPoints[draggingPointIndex].y = y;
    onUpdate({ points: newPoints.sort((a, b) => a.x - b.x) });
  };

  const handleMouseUp = () => {
    setDraggingPointIndex(null);
  };
  
  const handleGraphDoubleClick = (e: MouseEvent) => {
      const { x, y } = getCoords(e);
      const newPoints = [...settings.points, { x, y }].sort((a, b) => a.x - b.x);
      onUpdate({ points: newPoints });
  }

  return (
    <div className="space-y-4">
      <div>
        <Label>Channel</Label>
        <Select value={settings.channel} onValueChange={(value) => onUpdate({ channel: value })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
                <SelectItem value="rgb">RGB</SelectItem>
                <SelectItem value="r">Red</SelectItem>
                <SelectItem value="g">Green</SelectItem>
                <SelectItem value="b">Blue</SelectItem>
            </SelectContent>
        </Select>
      </div>
      <div>
        <Label>{t.curves}</Label>
        <div 
          ref={graphRef}
          className="aspect-square bg-muted rounded-md my-2 relative cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleGraphDoubleClick}
        >
          {/* Grid lines */}
          <div className="absolute top-0 left-1/4 w-px h-full bg-foreground/10"></div>
          <div className="absolute top-0 left-1/2 w-px h-full bg-foreground/20"></div>
          <div className="absolute top-0 left-3/4 w-px h-full bg-foreground/10"></div>
          <div className="absolute left-0 top-1/4 h-px w-full bg-foreground/10"></div>
          <div className="absolute left-0 top-1/2 h-px w-full bg-foreground/20"></div>
          <div className="absolute left-0 top-3/4 h-px w-full bg-foreground/10"></div>
          <div className="absolute top-0 left-0 w-full h-full" style={{ background: 'linear-gradient(to left top, black, transparent, white)'}}></div>
          
          {/* Curve line */}
          <svg className="absolute top-0 left-0 w-full h-full" viewBox="0 0 255 255" preserveAspectRatio="none">
            <path 
              d={`M ${settings.points.map((p, i) => `${i === 0 ? '' : 'L '}${p.x} ${255 - p.y}`).join(' ')}`}
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              fill="none"
            />
          </svg>

          {/* Points */}
          {settings.points.map((point, index) => (
            <div
              key={index}
              className={cn(
                "absolute w-3 h-3 rounded-full border-2 bg-background cursor-pointer",
                draggingPointIndex === index ? "border-primary scale-125" : "border-primary/50"
              )}
              style={{
                left: `${(point.x / 255) * 100}%`,
                top: `${100 - (point.y / 255) * 100}%`,
                transform: 'translate(-50%, -50%)'
              }}
              onMouseDown={(e) => handleMouseDown(e, index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

const NoiseControls = ({ settings, onUpdate }: { settings: NoiseSettings, onUpdate: (newSettings: Partial<NoiseSettings>) => void }) => {
  const { t } = useLanguage();
  return (
    <div className="space-y-4">
      <div>
        <Label>{t.scale}</Label>
        <Slider value={[settings.scale]} onValueChange={(v) => onUpdate({ scale: v[0] })} min={1} max={500} step={1} />
        <p className="text-xs text-center text-muted-foreground">{settings.scale}</p>
      </div>
      <div>
        <Label>{t.octaves}</Label>
        <Slider value={[settings.octaves]} onValueChange={(v) => onUpdate({ octaves: v[0] })} min={1} max={8} step={1} />
        <p className="text-xs text-center text-muted-foreground">{settings.octaves}</p>
      </div>
      <div>
        <Label>{t.persistence}</Label>
        <Slider value={[settings.persistence]} onValueChange={(v) => onUpdate({ persistence: v[0] })} min={0.1} max={1} step={0.05} />
        <p className="text-xs text-center text-muted-foreground">{settings.persistence.toFixed(2)}</p>
      </div>
      <div>
        <Label>{t.lacunarity}</Label>
        <Slider value={[settings.lacunarity]} onValueChange={(v) => onUpdate({ lacunarity: v[0] })} min={1.0} max={4.0} step={0.1} />
        <p className="text-xs text-center text-muted-foreground">{settings.lacunarity.toFixed(1)}</p>
      </div>
      <div className="flex items-center justify-between">
        <Label>{t.monochromatic}</Label>
        <Switch checked={settings.monochromatic} onCheckedChange={(checked) => onUpdate({ monochromatic: checked })} />
      </div>
      <Button variant="outline" size="sm" className="w-full" onClick={() => onUpdate({ seed: Math.random() })}>
        <RefreshCw className="mr-2 h-4 w-4" />
        {t.newSeed}
      </Button>
    </div>
  );
};

export const AdjustmentPanel = ({ selectedLayer, onUpdateLayer }: AdjustmentPanelProps) => {
  const { t } = useLanguage();

  const handleReset = () => {
    if (!selectedLayer) return;
    let defaultSettings;
    switch (selectedLayer.type) {
      case 'hue-saturation':
        defaultSettings = { hue: 0, saturation: 1, lightness: 0 };
        break;
      case 'levels':
        defaultSettings = { inputShadow: 0, inputMidtone: 1, inputHighlight: 255, outputShadow: 0, outputHighlight: 255 };
        break;
      case 'curves':
        defaultSettings = { channel: 'rgb', points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
        break;
      case 'noise':
        defaultSettings = { type: 'perlin', scale: 100, octaves: 3, persistence: 0.5, lacunarity: 2.0, seed: Math.random(), monochromatic: true };
        break;
      default:
        return;
    }
    onUpdateLayer(selectedLayer.id, defaultSettings);
  };

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
      case 'noise':
        return <NoiseControls settings={selectedLayer.settings as NoiseSettings} onUpdate={handleUpdate} />;
      default:
        return <p className="text-sm text-muted-foreground">{t.noControls}</p>;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>{selectedLayer.name}</CardTitle>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleReset}>
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Reset to Default</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardHeader>
      <CardContent>
        {renderControls()}
      </CardContent>
    </Card>
  );
};