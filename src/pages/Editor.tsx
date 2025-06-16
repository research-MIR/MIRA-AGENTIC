import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadCloud, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Layer, AdjustmentLayer, Mask } from "@/types/editor";
import { LayerPanel } from "@/components/Editor/LayerPanel";
import { AdjustmentPanel } from "@/components/Editor/AdjustmentPanel";
import { useImageProcessor } from "@/hooks/useImageProcessor";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

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
    let newLayer: AdjustmentLayer;
    const defaultMask: Mask = {
      imageData: new ImageData(1, 1), // Placeholder, will be resized
      enabled: true,
    };

    switch (type) {
      case 'hue-saturation':
        newLayer = { id: `layer-${Date.now()}`, name: t.hueSaturation, type, visible: true, opacity: 1, mask: defaultMask, settings: { hue: 0, saturation: 1, lightness: 0 } };
        break;
      case 'levels':
        newLayer = { id: `layer-${Date.now()}`, name: t.levels, type, visible: true, opacity: 1, mask: defaultMask, settings: { inputShadow: 0, inputMidtone: 1, inputHighlight: 255, outputShadow: 0, outputHighlight: 255 } };
        break;
      case 'curves':
        newLayer = { id: `layer-${Date.now()}`, name: t.curves, type, visible: true, opacity: 1, mask: defaultMask, settings: { channel: 'rgb', points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] } };
        break;
    }
    
    setLayers(prev => [newLayer, ...prev]);
    setSelectedLayerId(newLayer.id);
  };

  const updateLayer = (layerId: string, newSettings: any) => {
    setLayers(layers => layers.map(l => 
      l.id === layerId ? { ...l, settings: { ...(l.settings as any), ...newSettings } } : l
    ));
  };
  
  const updateLayerOpacity = (layerId: string, opacity: number) => {
    setLayers(layers => layers.map(l => 
      l.id === layerId ? { ...l, opacity } : l
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

  const reorderLayers = (sourceIndex: number, destIndex: number) => {
    const items = Array.from(layers);
    const [reorderedItem] = items.splice(sourceIndex, 1);
    items.splice(destIndex, 0, reorderedItem);
    setLayers(items);
  };

  const selectedLayer = layers.find(l => l.id === selectedLayerId) as AdjustmentLayer | undefined;

  return (
    <div className="flex flex-col h-screen">
      <header className="p-4 border-b flex justify-between items-center shrink-0 bg-background">
        <div>
          <h1 className="text-2xl font-bold">{t.imageEditor}</h1>
          <p className="text-muted-foreground text-sm">{t.imageEditorDescription}</p>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
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
              onReorderLayers={reorderLayers}
              onUpdateOpacity={updateLayerOpacity}
            />
            <AdjustmentPanel 
              selectedLayer={selectedLayer}
              onUpdateLayer={updateLayer}
            />
          </div>
        </div>

        {/* Main Content: Canvas */}
        <main className="flex-1 flex items-center justify-center p-8 bg-muted/40" {...dropzoneProps}>
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
    </div>
  );
};

export default Editor;