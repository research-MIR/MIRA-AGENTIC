import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useState } from "react";

interface ImageCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  beforeUrl: string;
  afterUrl: string;
}

export const ImageCompareModal = ({ isOpen, onClose, beforeUrl, afterUrl }: ImageCompareModalProps) => {
  const [sliderPosition, setSliderPosition] = useState(50);

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl p-4">
        <DialogHeader>
          <DialogTitle>Compare Before & After</DialogTitle>
          <DialogDescription>
            Drag the slider to compare the original and refined images.
          </DialogDescription>
        </DialogHeader>
        <div className="relative w-full aspect-auto overflow-hidden select-none rounded-md border">
          {/* Before Image (Bottom Layer) */}
          <img
            src={beforeUrl}
            alt="Before"
            className="w-full h-full object-contain"
          />
          {/* After Image (Top Layer, clipped) */}
          <div
            className="absolute top-0 left-0 w-full h-full overflow-hidden"
            style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
          >
            <img
              src={afterUrl}
              alt="After"
              className="w-full h-full object-contain"
            />
          </div>
          {/* Slider Handle */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-white/80 cursor-ew-resize shadow-lg"
            style={{ left: `${sliderPosition}%`, transform: 'translateX(-50%)' }}
          >
             <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 left-1/2 h-8 w-8 rounded-full bg-white/80 shadow-lg border-2 border-white flex items-center justify-center">
                <div className="h-4 w-1 bg-gray-500 rounded-full" />
             </div>
          </div>
        </div>
        <Slider
          value={[sliderPosition]}
          onValueChange={(value) => setSliderPosition(value[0])}
          min={0}
          max={100}
          step={0.1}
          className="w-[80%] mx-auto mt-4"
        />
      </DialogContent>
    </Dialog>
  );
};