import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Eye, EyeOff } from "lucide-react";
import { Layer, AdjustmentLayer } from "@/types/editor";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/LanguageContext";
import { useRef } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";

interface LayerPanelProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onAddLayer: (type: AdjustmentLayer['type']) => void;
  onToggleVisibility: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  onReorderLayers: (sourceIndex: number, destIndex: number) => void;
  onUpdateOpacity: (id: string, opacity: number) => void;
}

export const LayerPanel = ({ layers, selectedLayerId, onSelectLayer, onAddLayer, onToggleVisibility, onDeleteLayer, onReorderLayers, onUpdateOpacity }: LayerPanelProps) => {
  const { t } = useLanguage();
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    dragItem.current = index;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      onReorderLayers(dragItem.current, dragOverItem.current);
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.layers}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Button onClick={() => onAddLayer('levels')} className="w-full">
            <Plus className="mr-2 h-4 w-4" /> {t.addLevels}
          </Button>
          <Button onClick={() => onAddLayer('curves')} className="w-full">
            <Plus className="mr-2 h-4 w-4" /> {t.addCurves}
          </Button>
          <Button onClick={() => onAddLayer('hue-saturation')} className="w-full">
            <Plus className="mr-2 h-4 w-4" /> {t.addSaturation}
          </Button>
        </div>
        <div className="mt-4 space-y-1">
          {layers.map((layer, index) => (
            <div 
              key={layer.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => e.preventDefault()}
              onClick={() => onSelectLayer(layer.id)}
              className={cn(
                "p-2 rounded-md cursor-grab border",
                selectedLayerId === layer.id ? "bg-primary/10 border-primary" : "bg-muted/50 hover:bg-muted"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onToggleVisibility(layer.id); }}>
                    {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                  <div className="w-10 h-8 bg-white border rounded-sm flex-shrink-0">
                    {/* Placeholder for mask thumbnail */}
                  </div>
                  <span className="text-sm font-medium">{layer.name}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onDeleteLayer(layer.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="mt-2 px-2">
                <Label className="text-xs text-muted-foreground">Opacity</Label>
                <Slider 
                  value={[layer.opacity * 100]} 
                  onValueChange={(v) => onUpdateOpacity(layer.id, v[0] / 100)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          ))}
          {layers.length === 0 && <p className="text-xs text-center text-muted-foreground py-2">{t.noLayers}</p>}
        </div>
      </CardContent>
    </Card>
  );
};