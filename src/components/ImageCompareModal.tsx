import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { useState, useRef, useCallback, MouseEvent, TouchEvent } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Loader2 } from "lucide-react";

interface ImageCompareModalProps {
  isOpen: boolean;
  onClose: () => void;
  beforeUrl: string;
  afterUrl: string;
}

const ImageDisplay = ({ imageUrl, alt }: { imageUrl: string, alt: string }) => {
  const { displayUrl, isLoading, error } = useSecureImage(imageUrl);

  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted rounded-md">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !displayUrl) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-destructive/10 rounded-md text-destructive text-sm p-2">
        Error loading {alt} image.
      </div>
    );
  }

  return (
    <img
      src={displayUrl}
      alt={alt}
      className="w-full h-full object-contain pointer-events-none"
    />
  );
};

export const ImageCompareModal = ({ isOpen, onClose, beforeUrl, afterUrl }: ImageCompareModalProps) => {
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useLanguage();

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPosition(percentage);
  }, []);

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    handleMove(e.clientX);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.preventDefault();
    handleMove(e.clientX);
  };

  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleMove(e.touches[0].clientX);
  };

  const handleTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    handleMove(e.touches[0].clientX);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  if (!isOpen) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl p-4">
        <DialogHeader>
          <DialogTitle>{t('compareBeforeAfter')}</DialogTitle>
          <DialogDescription>
            {t('compareDescription')}
          </DialogDescription>
        </DialogHeader>
        <div
          ref={containerRef}
          className="relative w-full aspect-auto overflow-hidden select-none rounded-md border cursor-ew-resize"
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <ImageDisplay imageUrl={beforeUrl} alt="Before" />
          
          <div
            className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none"
            style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
          >
            <ImageDisplay imageUrl={afterUrl} alt="After" />
          </div>
          
          <div
            className="absolute top-0 bottom-0 w-1 bg-white/80 cursor-ew-resize shadow-lg pointer-events-none"
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