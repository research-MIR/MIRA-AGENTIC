import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Eye, EyeOff, Droplets, BarChartHorizontal, SunMoon } from "lucide-react";
import { Layer } from "@/types/editor";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/LanguageContext";

interface LayerPanelProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onAddLayer: (type: 'hsl' | 'levels' | 'dodge-burn') => void;
  onToggleVisibility: (id: string) => void;
  onDeleteLayer: (id: string) => void;
}

export const LayerPanel = ({ layers, selectedLayerId, onSelectLayer, onAddLayer, onToggleVisibility, onDeleteLayer }: LayerPanelProps) => {
  const { t } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.layers}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Button onClick={() => onAddLayer('hsl')} className="w-full">
            <Droplets className="mr-2 h-4 w-4" /> {t.addHsl}
          </Button>
          <Button onClick={() => onAddLayer('levels')} className="w-full">
            <BarChartHorizontal className="mr-2 h-4 w-4" /> {t.addLevels}
          </Button>
           <Button onClick={() => onAddLayer('dodge-burn')} className="w-full">
            <SunMoon className="mr-2 h-4 w-4" /> {t.addDodgeBurn}
          </Button>
        </div>
        <div className="mt-4 space-y-2 max-h-60 overflow-y-auto">
          {layers.map(layer => (
            <div 
              key={layer.id}
              onClick={() => onSelectLayer(layer.id)}
              className={cn(
                "flex items-center justify-between p-2 rounded-md cursor-pointer border",
                selectedLayerId === layer.id ? "bg-primary/10 border-primary" : "bg-muted/50 hover:bg-muted"
              )}
            >
              <span className="text-sm font-medium">{layer.name}</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onToggleVisibility(layer.id); }}>
                  {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onDeleteLayer(layer.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
          {layers.length === 0 && <p className="text-xs text-center text-muted-foreground py-2">{t.noLayers}</p>}
        </div>
      </CardContent>
    </Card>
  );
};