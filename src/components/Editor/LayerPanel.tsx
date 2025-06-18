import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Eye, EyeOff, Sparkles, SlidersHorizontal, Spline, Droplets } from "lucide-react";
import { Layer, AdjustmentLayer, BlendMode } from "@/types/editor";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/context/LanguageContext";
import { useRef } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface LayerPanelProps {
  layers: Layer[];
  selectedLayerId: string | null;
  onSelectLayer: (id: string) => void;
  onAddLayer: (type: AdjustmentLayer['type']) => void;
  onToggleVisibility: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  onReorderLayers: (sourceIndex: number, destIndex: number) => void;
  onUpdateOpacity: (id: string, opacity: number) => void;
  onUpdateBlendMode: (id: string, blendMode: BlendMode) => void;
}

const blendModes: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 
  'color-dodge', 'color-burn', 'difference', 'exclusion', 'hue', 
  'saturation', 'color', 'luminosity'
];

export const LayerPanel = ({ 
  layers, 
  selectedLayerId, 
  onSelectLayer, 
  onAddLayer, 
  onToggleVisibility, 
  onDeleteLayer, 
  onReorderLayers, 
  onUpdateOpacity,
  onUpdateBlendMode
}: LayerPanelProps) => {
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
        <CardTitle>{t('layers')}</CardTitle>
      </CardHeader>
      <CardContent>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="w-full">
              <Plus className="mr-2 h-4 w-4" /> {t('addAdjustment')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <DropdownMenuItem onSelect={() => onAddLayer('noise')}>
              <Sparkles className="mr-2 h-4 w-4" />
              <span>{t('addNoise')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddLayer('levels')}>
              <SlidersHorizontal className="mr-2 h-4 w-4" />
              <span>{t('addLevels')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddLayer('curves')}>
              <Spline className="mr-2 h-4 w-4" />
              <span>{t('addCurves')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddLayer('hue-saturation')}>
              <Droplets className="mr-2 h-4 w-4" />
              <span>{t('addSaturation')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        
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
                "p-2 rounded-md cursor-grab border space-y-2",
                selectedLayerId === layer.id ? "bg-primary/10 border-primary" : "bg-muted/50 hover:bg-muted"
              )}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onToggleVisibility(layer.id); }}>
                    {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
                  </Button>
                  <span className="text-sm font-medium">{layer.name}</span>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); onDeleteLayer(layer.id); }}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
              <div className="px-1 space-y-2">
                <div onClick={(e) => e.stopPropagation()}>
                  <Label className="text-xs text-muted-foreground">Blend Mode</Label>
                  <Select value={layer.blendMode} onValueChange={(value: BlendMode) => onUpdateBlendMode(layer.id, value)}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {blendModes.map(mode => (
                        <SelectItem key={mode} value={mode} className="capitalize text-xs">{mode}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Opacity</Label>
                  <Slider 
                    value={[layer.opacity * 100]} 
                    onValueChange={(v) => onUpdateOpacity(layer.id, v[0] / 100)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            </div>
          ))}
          {layers.length === 0 && <p className="text-xs text-center text-muted-foreground py-2">{t('noLayers')}</p>}
        </div>
      </CardContent>
    </Card>
  );
};