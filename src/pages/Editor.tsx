import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UploadCloud, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Layer, AdjustmentLayer } from "@/types/editor";
import { LayerPanel } from "@/components/Editor/LayerPanel";
import { AdjustmentPanel } from "@/components/Editor/AdjustmentPanel";
import { useImageProcessor } from "@/hooks/useImageProcessor";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";

const Editor = () => {
  const { t } = useLanguage();
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImageProcessor(baseImage, layers, canvasRef);

  const handleImageUpload = useCallback((file: File) => {
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          setBaseImage(img);
          setLayers([]); // Reset layers when a new image is loaded
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

  const addLayer = (type: AdjustmentLayer['type']) => {
    const newLayer: AdjustmentLayer = {
      id: `layer-${Date.now()}`,
      name: `${type.charAt(0).toUpperCase() + type.slice(1)}`,
      type: type,
      visible: true,
      settings: {
        saturation: 1,
        // Default settings for other types would go here
      },
    };
    setLayers(prev => [...prev, newLayer]);
    setSelectedLayerId(newLayer.id);
  };

  const updateLayer = (layerId: string, newSettings: any) => {
    setLayers(layers => layers.map(l => 
      l.id === layerId ? { ...l, settings: { ...l.settings, ...newSettings } } : l
    ));
  };

  const toggleLayerVisibility = (layerId: string) => {
    setLayers(layers => layers.map(l => 
      l.id === layerId ? { ...l, visible: !l.visible } : l
    ));
  };

  const deleteLayer = (layerId: string) => {
    setLayers(layers => layers.filter(l => l.id !== layerId));
    if (selectedLayerId === layerId) {
      setSelectedLayerId(null);
    }
  };

  const selectedLayer = layers.find(l => l.id === selectedLayerId) as AdjustmentLayer | undefined;

  return (
    <div className="flex h-full bg-muted/40">
      {/* Left Panel: Layers & Adjustments */}
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
          <AdjustmentPanel 
            selectedLayer={selectedLayer}
            onUpdateLayer={updateLayer}
          />
        </div>
      </div>

      {/* Main Content: Canvas */}
      <main className="flex-1 flex items-center justify-center p-8" {...dropzoneProps}>
        <div className={cn("w-full h-full flex items-center justify-center transition-colors", isDraggingOver && "bg-primary/10 rounded-lg")}>
          {baseImage ? (
            <canvas ref={canvasRef} className="max-w-full max-h-full object-contain shadow-lg" />
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