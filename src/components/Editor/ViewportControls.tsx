import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { ZoomIn, ZoomOut, Frame } from "lucide-react";

interface ViewportControlsProps {
  zoom: number;
  setZoom: (zoom: number) => void;
  fitToView: () => void;
}

export const ViewportControls = ({ zoom, setZoom, fitToView }: ViewportControlsProps) => {
  const handleZoomChange = (newZoom: number) => {
    setZoom(Math.max(0.1, Math.min(newZoom, 10)));
  };

  return (
    <div className="absolute bottom-4 right-4 bg-background/80 backdrop-blur-sm p-2 rounded-lg shadow-lg flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={() => handleZoomChange(zoom / 1.5)}>
        <ZoomOut className="h-4 w-4" />
      </Button>
      <Slider
        value={[zoom * 100]}
        onValueChange={(value) => handleZoomChange(value[0] / 100)}
        min={10}
        max={1000}
        step={1}
        className="w-32"
      />
      <Button variant="ghost" size="icon" onClick={() => handleZoomChange(zoom * 1.5)}>
        <ZoomIn className="h-4 w-4" />
      </Button>
      <span className="text-xs font-mono w-12 text-center">{(zoom * 100).toFixed(0)}%</span>
      <Button variant="ghost" size="icon" onClick={fitToView}>
        <Frame className="h-4 w-4" />
      </Button>
    </div>
  );
};