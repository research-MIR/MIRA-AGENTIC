import { useState, useCallback, useRef, useEffect, WheelEvent, MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UploadCloud, Image as ImageIcon } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Layer, AdjustmentLayer, Mask, BlendMode } from "@/types/editor";
import { LayerPanel } from "@/components/Editor/LayerPanel";
import { AdjustmentPanel } from "@/components/Editor/AdjustmentPanel";
import { useImageProcessor } from "@/hooks/useImageProcessor";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ViewportControls } from "@/components/Editor/ViewportControls";
import { useImageTransferStore } from "@/store/imageTransferStore";
import { showError } from "@/utils/toast";

const Editor = () => {
  const { t } = useLanguage();
  const [baseImage, setBaseImage] = useState<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mainContainerRef = useRef<HTMLDivElement>(null);

  // Viewport state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const lastMousePosition = useRef({ x: 0, y: 0 });

  const processedCanvas = useImageProcessor(baseImage, layers);
  const { consumeImageUrl } = useImageTransferStore();

  const handleImageUpload = useCallback((file: File) => {
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          setBaseImage(img);
          setLayers([]);
          setSelectedLayerId(null);
        };
        img.src = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  }, []);

  useEffect(() => {
    const { url } = consumeImageUrl();
    if (url) {
      const fetchImageAsFile = async (imageUrl: string) => {
        try {
          const response = await fetch(imageUrl);
          const blob = await response.blob();
          const filename = imageUrl.split('/').pop() || 'image.png';
          const file = new File([blob], filename, { type: blob.type });
          handleImageUpload(file);
        } catch (e) {
          console.error("Failed to fetch transferred image:", e);
          showError("Could not load the transferred image.");
        }
      };
      fetchImageAsFile(url);
    }
  }, [consumeImageUrl, handleImageUpload]);

  const { isDraggingOver, dropzoneProps } = useDropzone({
    onDrop: (files) => handleImageUpload(files[0]),
  });

  const fitToView = useCallback(() => {
    if (!baseImage || !mainContainerRef.current) return;
    const containerWidth = mainContainerRef.current.clientWidth - 64; // padding
    const containerHeight = mainContainerRef.current.clientHeight - 64; // padding
    const imageWidth = baseImage.naturalWidth;
    const imageHeight = baseImage.naturalHeight;

    const scaleX = containerWidth / imageWidth;
    const scaleY = containerHeight / imageHeight;
    const newZoom = Math.min(scaleX, scaleY, 1); // Don't zoom in past 100% on fit
    
    setZoom(newZoom);
    setPan({
      x: (containerWidth - imageWidth * newZoom) / 2 + 32,
      y: (containerHeight - imageHeight * newZoom) / 2 + 32,
    });
  }, [baseImage]);

  useEffect(() => {
    if (baseImage) {
      fitToView();
    }
  }, [baseImage, fitToView]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !processedCanvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = mainContainerRef.current?.clientWidth || 0;
    canvas.height = mainContainerRef.current?.clientHeight || 0;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    ctx.drawImage(processedCanvas, 0, 0);
    ctx.restore();
  }, [processedCanvas, zoom, pan]);

  // Keyboard listeners for spacebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (isSpacePressed) {
      setIsPanning(true);
      lastMousePosition.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePosition.current.x;
      const dy = e.clientY - lastMousePosition.current.y;
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePosition.current = { x: e.clientX, y: e.clientY };
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const scaleAmount = 1.1;
    const newZoom = e.deltaY > 0 ? zoom / scaleAmount : zoom * scaleAmount;
    const clampedZoom = Math.max(0.1, Math.min(newZoom, 10));

    const rect = canvasRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const mousePoint = { x: (mouseX - pan.x) / zoom, y: (mouseY - pan.y) / zoom };

    setPan({
      x: mouseX - mousePoint.x * clampedZoom,
      y: mouseY - mousePoint.y * clampedZoom,
    });
    setZoom(clampedZoom);
  };

  const addLayer = (type: AdjustmentLayer['type']) => {
    let newLayer: AdjustmentLayer;
    const defaultMask: Mask = { imageData: new ImageData(1, 1), enabled: true };
    const commonProps = { id: `layer-${Date.now()}`, visible: true, opacity: 1, blendMode: 'overlay' as BlendMode, mask: defaultMask };
    switch (type) {
      case 'hue-saturation': newLayer = { ...commonProps, name: t('hueSaturation'), type, settings: { hue: 0, saturation: 1, lightness: 0 } }; break;
      case 'levels': newLayer = { ...commonProps, name: t('levels'), type, settings: { inputShadow: 0, inputMidtone: 1, inputHighlight: 255, outputShadow: 0, outputHighlight: 255 } }; break;
      case 'curves': newLayer = { ...commonProps, name: t('curves'), type, settings: { channel: 'rgb', points: [{ x: 0, y: 0 }, { x: 255, y: 255 }] } }; break;
      case 'noise': newLayer = { ...commonProps, name: t('noise'), type, opacity: 0.2, settings: { type: 'perlin', scale: 100, octaves: 3, persistence: 0.5, lacunarity: 2.0, seed: Math.random(), monochromatic: true } }; break;
    }
    setLayers(prev => [newLayer, ...prev]);
    setSelectedLayerId(newLayer.id);
  };

  const updateLayer = (layerId: string, newSettings: any) => setLayers(layers => layers.map(l => l.id === layerId ? { ...l, settings: { ...(l.settings as any), ...newSettings } } : l));
  const updateLayerOpacity = (layerId: string, opacity: number) => setLayers(layers => layers.map(l => l.id === layerId ? { ...l, opacity } : l));
  const updateLayerBlendMode = (layerId: string, blendMode: BlendMode) => setLayers(layers => layers.map(l => l.id === layerId ? { ...l, blendMode } : l));
  const toggleLayerVisibility = (layerId: string) => setLayers(layers => layers.map(l => l.id === layerId ? { ...l, visible: !l.visible } : l));
  const deleteLayer = (layerId: string) => { setLayers(layers => layers.filter(l => l.id !== layerId)); if (selectedLayerId === layerId) setSelectedLayerId(null); };
  const reorderLayers = (sourceIndex: number, destIndex: number) => {
    setLayers(prevLayers => {
      const result = Array.from(prevLayers);
      const [removed] = result.splice(sourceIndex, 1);
      result.splice(destIndex, 0, removed);
      return result;
    });
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b p-2 flex justify-between items-center shrink-0">
        <h1 className="text-xl font-bold">{t('imageEditor')}</h1>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r p-4 space-y-4 overflow-y-auto">
          <LayerPanel 
            layers={layers}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayerId}
            onAddLayer={addLayer}
            onToggleVisibility={toggleLayerVisibility}
            onDeleteLayer={deleteLayer}
            onReorderLayers={reorderLayers}
            onUpdateOpacity={updateLayerOpacity}
            onUpdateBlendMode={updateLayerBlendMode}
          />
          <AdjustmentPanel 
            selectedLayer={layers.find(l => l.id === selectedLayerId) as AdjustmentLayer | undefined}
            onUpdateLayer={updateLayer}
          />
        </aside>
        <main ref={mainContainerRef} className="flex-1 bg-muted/20 relative flex items-center justify-center overflow-hidden">
          {baseImage ? (
            <>
              <canvas 
                ref={canvasRef} 
                className={cn(isSpacePressed ? 'cursor-grab' : 'cursor-crosshair', isPanning && 'cursor-grabbing')}
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
              />
              <ViewportControls zoom={zoom} setZoom={setZoom} fitToView={fitToView} />
            </>
          ) : (
            <div {...dropzoneProps} className={cn("w-full h-full flex items-center justify-center p-8", isDraggingOver && "bg-primary/10")}>
              <div className="text-center p-8 border-2 border-dashed rounded-lg">
                <UploadCloud className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-medium">{t('uploadToStart')}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t('dragAndDrop')}</p>
                <Button className="mt-4" onClick={() => fileInputRef.current?.click()}>{t('uploadImage')}</Button>
                <Input ref={fileInputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && handleImageUpload(e.target.files[0])} />
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default Editor;