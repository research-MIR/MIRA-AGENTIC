import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadCloud, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Layer, AdjustmentLayer, PaintLayer, HSLAdjustment, LevelsAdjustment, DodgeBurnSettings } from "@/types/editor";
import { LayerPanel } from "@/components/Editor/LayerPanel";
import { AdjustmentPanel } from "@/components/Editor/AdjustmentPanel";
import { BrushPanel } from "@/components/Editor/BrushPanel";
import { useImageProcessor } from "@/hooks/useImageProcessor";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";

const Editor = () => {
  const { t } = useLanguage();
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [layerCanvases, setLayerCanvases] = useState<Map<string, HTMLCanvasElement>>(new Map());
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isPainting = useRef(false);
  const lastPos = useRef<{ x: number, y: number } | null>(null);
  const [brushPreview, setBrushPreview] = useState({ x: 0, y: 0, visible: false });

  useImageProcessor(baseImage, layers, layerCanvases, canvasRef);

  const handleImageUpload = useCallback((file: File) => {
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          setBaseImage(img);
          setLayers([]);
          setLayerCanvases(new Map());
          setSelectedLayerId(null);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const { isDraggingOver, dropzoneProps } = useDropzone({
    onDrop: (files) => handleImageUpload(files[0]),
  });

  const addLayer = (type: 'hsl' | 'levels' | 'dodge-burn') => {
    const newId = `layer-${Date.now()}`;
    let newLayer: Layer;

    if (type === 'hsl' || type === 'levels') {
      const settings = type === 'hsl' 
        ? [
            { range: 'master', hue: 0, saturation: 0, lightness: 0 },
            { range: 'reds', hue: 0, saturation: 0, lightness: 0 },
            { range: 'yellows', hue: 0, saturation: 0, lightness: 0 },
            { range: 'greens', hue: 0, saturation: 0, lightness: 0 },
            { range: 'cyans', hue: 0, saturation: 0, lightness: 0 },
            { range: 'blues', hue: 0, saturation: 0, lightness: 0 },
            { range: 'magentas', hue: 0, saturation: 0, lightness: 0 },
          ]
        : { inBlack: 0, inWhite: 255, inGamma: 1.0, outBlack: 0, outWhite: 255 };
      
      newLayer = { id: newId, name: type.toUpperCase(), type, visible: true, settings } as AdjustmentLayer;
    } else { // dodge-burn
      newLayer = {
        id: newId,
        name: 'Dodge & Burn',
        type: 'dodge-burn',
        visible: true,
        settings: { tool: 'dodge', size: 50, opacity: 20, hardness: 50 },
      } as PaintLayer;
      
      if (baseImage) {
        const newCanvas = document.createElement('canvas');
        newCanvas.width = baseImage.naturalWidth;
        newCanvas.height = baseImage.naturalHeight;
        setLayerCanvases(prev => new Map(prev).set(newId, newCanvas));
      }
    }
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(newId);
  };

  const updateLayer = (layerId: string, newSettings: any) => {
    setLayers(layers => layers.map(l => 
      l.id === layerId ? { ...l, settings: newSettings } : l
    ));
  };
  
  const updatePaintLayer = (layerId: string, newSettings: Partial<PaintLayer['settings']>) => {
    setLayers(layers => layers.map(l => 
      l.id === layerId ? { ...l, settings: {...l.settings, ...newSettings} } : l
    ));
  };

  const toggleLayerVisibility = (layerId: string) => {
    setLayers(layers => layers.map(l => 
      l.id === layerId ? { ...l, visible: !l.visible } : l
    ));
  };

  const deleteLayer = (layerId: string) => {
    setLayers(layers => layers.filter(l => l.id !== layerId));
    setLayerCanvases(prev => {
      const newMap = new Map(prev);
      newMap.delete(layerId);
      return newMap;
    });
    if (selectedLayerId === layerId) {
      setSelectedLayerId(null);
    }
  };

  const selectedLayer = layers.find(l => l.id === selectedLayerId);

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>): { x: number, y: number } | null => {
    if (!canvasRef.current) return null;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (selectedLayer?.type !== 'dodge-burn') return;
    isPainting.current = true;
    lastPos.current = getCanvasCoordinates(e);
  };

  const handleMouseUp = () => {
    isPainting.current = false;
    lastPos.current = null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPainting.current || !selectedLayer || selectedLayer.type !== 'dodge-burn' || !lastPos.current) return;
    
    const currentPos = getCanvasCoordinates(e);
    if (!currentPos) return;

    const layerCanvas = layerCanvases.get(selectedLayer.id);
    if (!layerCanvas) return;
    
    const ctx = layerCanvas.getContext('2d');
    if (!ctx) return;

    const { tool, size, opacity, hardness } = selectedLayer.settings;
    
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = size;
    
    const gradient = ctx.createRadialGradient(currentPos.x, currentPos.y, size * (hardness / 200), currentPos.x, currentPos.y, size / 2);
    
    if (tool === 'dodge') {
      gradient.addColorStop(0, `rgba(128, 128, 128, ${opacity / 100})`);
      gradient.addColorStop(1, `rgba(128, 128, 128, 0)`);
    } else { // burn
      gradient.addColorStop(0, `rgba(128, 128, 128, ${opacity / 100})`);
      gradient.addColorStop(1, `rgba(128, 128, 128, 0)`);
    }
    
    ctx.strokeStyle = gradient;
    
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(currentPos.x, currentPos.y);
    ctx.stroke();
    
    lastPos.current = currentPos;
    
    setLayerCanvases(new Map(layerCanvases));
  };

  const handleMouseMoveForPreview = (e: React.MouseEvent<HTMLDivElement>) => {
    if (selectedLayer?.type !== 'dodge-burn') {
        if (brushPreview.visible) setBrushPreview(p => ({ ...p, visible: false }));
        return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setBrushPreview({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        visible: true,
    });
  };

  return (
    <div className="flex h-full bg-muted/40">
      <div className="w-80 flex flex-col bg-background border-r">
        <div className="flex-1 p-4 space-y-6 overflow-y-auto">
          <LayerPanel 
            layers={layers}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
            onAddLayer={addLayer}
            onToggleVisibility={toggleLayerVisibility}
            onDeleteLayer={deleteLayer}
          />
          {selectedLayer?.type === 'dodge-burn' ? (
            <BrushPanel settings={(selectedLayer as PaintLayer).settings} onUpdateSettings={(s) => updatePaintLayer(selectedLayerId!, s)} />
          ) : (
            <AdjustmentPanel 
              selectedLayer={selectedLayer as AdjustmentLayer | undefined}
              onUpdateLayer={updateLayer}
            />
          )}
        </div>
      </div>

      <main className="flex-1 flex items-center justify-center p-8" {...dropzoneProps} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}>
        <div 
          className={cn("w-full h-full flex items-center justify-center transition-colors relative", isDraggingOver && "bg-primary/10 rounded-lg")}
          onMouseMove={handleMouseMoveForPreview}
          onMouseLeave={() => setBrushPreview(p => ({ ...p, visible: false }))}
        >
          {baseImage ? (
            <>
              <canvas 
                ref={canvasRef} 
                className="max-w-full max-h-full object-contain shadow-lg"
                style={{ cursor: selectedLayer?.type === 'dodge-burn' ? 'none' : 'default' }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
              />
              {brushPreview.visible && selectedLayer?.type === 'dodge-burn' && (
                <div
                  className="absolute rounded-full border border-white/80 pointer-events-none"
                  style={{
                    left: brushPreview.x,
                    top: brushPreview.y,
                    width: (selectedLayer.settings as DodgeBurnSettings).size,
                    height: (selectedLayer.settings as DodgeBurnSettings).size,
                    transform: 'translate(-50%, -50%)',
                    boxShadow: '0 0 0 1px black',
                  }}
                />
              )}
            </>
          ) : (
            <div className="text-center text-muted-foreground">
              <ImageIcon className="mx-auto h-24 w-24 mb-4" />
              <h2 className="text-xl font-semibold">{t.imageEditor}</h2>
              <p className="mb-4">{t.uploadToStart}</p>
              <Button onClick={() => fileInputRef.current?.click()}>
                <UploadCloud className="mr-2 h-4 w-4" />
                {t.uploadImage}
              </Button>
              <Input 
                ref={fileInputRef}
                type="file" 
                className="hidden" 
                accept="image/*" 
                onChange={(e) => e.target.files && handleImageUpload(e.target.files[0])} 
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default Editor;