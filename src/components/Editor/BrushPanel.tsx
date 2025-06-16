import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Sun, Moon } from "lucide-react";
import { DodgeBurnSettings } from "@/types/editor";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

interface BrushPanelProps {
  settings: DodgeBurnSettings;
  onUpdateSettings: (newSettings: Partial<DodgeBurnSettings>) => void;
}

export const BrushPanel = ({ settings, onUpdateSettings }: BrushPanelProps) => {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader><CardTitle>{t.brushSettings}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Button 
            variant={settings.tool === 'dodge' ? 'default' : 'outline'}
            onClick={() => onUpdateSettings({ tool: 'dodge' })}
          >
            <Sun className="mr-2 h-4 w-4" /> {t.dodge}
          </Button>
          <Button 
            variant={settings.tool === 'burn' ? 'default' : 'outline'}
            onClick={() => onUpdateSettings({ tool: 'burn' })}
          >
            <Moon className="mr-2 h-4 w-4" /> {t.burn}
          </Button>
        </div>
        <div>
          <Label>{t.brushSize}</Label>
          <Slider value={[settings.size]} onValueChange={v => onUpdateSettings({ size: v[0] })} min={1} max={200} step={1} />
        </div>
        <div>
          <Label>{t.brushOpacity}</Label>
          <Slider value={[settings.opacity]} onValueChange={v => onUpdateSettings({ opacity: v[0] })} min={1} max={100} step={1} />
        </div>
        <div>
          <Label>{t.brushHardness}</Label>
          <Slider value={[settings.hardness]} onValueChange={v => onUpdateSettings({ hardness: v[0] })} min={0} max={100} step={1} />
        </div>
      </CardContent>
    </Card>
  );
};