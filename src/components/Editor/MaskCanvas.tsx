import React, { useRef, useEffect, useState, useCallback } from 'react';

interface MaskCanvasProps {
  imageUrl: string;
  onMaskChange: (dataUrl: string) => void;
  brushSize: number; // This is now a relative value (e.g., 1-100)
  resetTrigger: number;
}

const MaskCanvasComponent = ({ imageUrl, onMaskChange, brushSize, resetTrigger }: MaskCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null); // Canvas for the brush preview
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const generateFinalMask = useCallback(() => {
    const drawingCanvas = drawingCanvasRef.current;
    if (!drawingCanvas) return;

    const finalMaskCanvas = document.createElement('canvas');
    finalMaskCanvas.width = drawingCanvas.width;
    finalMaskCanvas.height = drawingCanvas.height;
    const finalCtx = finalMaskCanvas.getContext('2d');
    if (!finalCtx) return;

    const drawingCtx = drawingCanvas.getContext('2d');
    if (!drawingCtx) return;
    const drawingImageData = drawingCtx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);
    const drawingData = drawingImageData.data;

    const finalMaskImageData = finalCtx.createImageData(drawingCanvas.width, drawingCanvas.height);
    const finalMaskData = finalMaskImageData.data;

    for (let i = 0; i < drawingData.length; i += 4) {
      if (drawingData[i + 3] > 0) {
        finalMaskData[i] = 255;
        finalMaskData[i + 1] = 255;
        finalMaskData[i + 2] = 255;
        finalMaskData[i + 3] = 255;
      } else {
        finalMaskData[i] = 0;
        finalMaskData[i + 1] = 0;
        finalMaskData[i + 2] = 0;
        finalMaskData[i + 3] = 255;
      }
    }

    finalCtx.putImageData(finalMaskImageData, 0, 0);
    onMaskChange(finalMaskCanvas.toDataURL('image/png'));
  }, [onMaskChange]);

  const clearCanvas = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    generateFinalMask();
  }, [generateFinalMask]);

  const clearPreviewCanvas = useCallback(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    if (resetTrigger > 0) {
      clearCanvas();
    }
  }, [resetTrigger, clearCanvas]);

  useEffect(() => {
    const imageCanvas = imageCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (!imageCanvas || !drawingCanvas || !previewCanvas || !imageUrl) return;
    const ctx = imageCanvas.getContext('2d');
    if (!ctx) return;

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageUrl;
    image.onload = () => {
      imageCanvas.width = image.naturalWidth;
      imageCanvas.height = image.naturalHeight;
      drawingCanvas.width = image.naturalWidth;
      drawingCanvas.height = image.naturalHeight;
      previewCanvas.width = image.naturalWidth;
      previewCanvas.height = image.naturalHeight;
      
      ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
      clearCanvas();
    };
  }, [imageUrl, clearCanvas]);

  const getCoords = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const canvasX = (clientX - rect.left) * (canvas.width / rect.width);
    const canvasY = (clientY - rect.top) * (canvas.height / rect.height);

    return { x: canvasX, y: canvasY };
  }, []);

  const drawBrushPreview = useCallback((x: number, y: number) => {
    const previewCanvas = previewCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;
    if (!previewCanvas || !imageCanvas) return;
    const ctx = previewCanvas.getContext('2d');
    if (!ctx) return;

    clearPreviewCanvas();

    const smallerDimension = Math.min(imageCanvas.width, imageCanvas.height);
    const dynamicBrushSize = (brushSize / 100) * (smallerDimension * 0.2);

    ctx.beginPath();
    ctx.arc(x, y, dynamicBrushSize / 2, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [brushSize, clearPreviewCanvas]);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    clearPreviewCanvas();
    setIsDrawing(true);
    const coords = getCoords(e);
    lastPoint.current = coords;
  }, [getCoords, clearPreviewCanvas]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = drawingCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !lastPoint.current || !canvas) return;
    
    const coords = getCoords(e);

    const smallerDimension = Math.min(canvas.width, canvas.height);
    const dynamicBrushSize = (brushSize / 100) * (smallerDimension * 0.2);

    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
    ctx.lineWidth = dynamicBrushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.closePath();
    lastPoint.current = coords;
  }, [isDrawing, getCoords, brushSize]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPoint.current = null;
    generateFinalMask();
  }, [isDrawing, generateFinalMask]);

  const handleContainerMouseMove = (e: React.MouseEvent) => {
    if (isDrawing) {
      draw(e);
    } else {
      const coords = getCoords(e);
      drawBrushPreview(coords.x, coords.y);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-full flex items-center justify-center cursor-crosshair"
      onMouseDown={startDrawing}
      onMouseMove={handleContainerMouseMove}
      onMouseUp={stopDrawing}
      onMouseLeave={() => { stopDrawing(); clearPreviewCanvas(); }}
      onTouchStart={startDrawing}
      onTouchMove={draw}
      onTouchEnd={stopDrawing}
    >
      <canvas 
        ref={imageCanvasRef} 
        className="absolute max-w-full max-h-full object-contain" 
      />
      <canvas
        ref={drawingCanvasRef}
        className="absolute max-w-full max-h-full object-contain"
      />
      <canvas
        ref={previewCanvasRef}
        className="absolute max-w-full max-h-full object-contain pointer-events-none"
      />
    </div>
  );
};

export const MaskCanvas = React.memo(MaskCanvasComponent);