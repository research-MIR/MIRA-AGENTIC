import React, { useRef, useEffect, useState, useCallback } from 'react';

interface MaskCanvasProps {
  imageUrl: string;
  onMaskChange: (dataUrl: string) => void;
  brushSize: number;
  resetTrigger: number;
}

export const MaskCanvas = ({ imageUrl, onMaskChange, brushSize, resetTrigger }: MaskCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const clearCanvas = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onMaskChange(canvas.toDataURL('image/png'));
  }, [onMaskChange]);

  useEffect(() => {
    if (resetTrigger > 0) {
      clearCanvas();
    }
  }, [resetTrigger, clearCanvas]);

  // Effect to draw the base image
  useEffect(() => {
    const imageCanvas = imageCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    if (!imageCanvas || !drawingCanvas || !imageUrl) return;
    const ctx = imageCanvas.getContext('2d');
    if (!ctx) return;

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageUrl;
    image.onload = () => {
      const container = containerRef.current;
      if (container) {
        const { width, height } = container.getBoundingClientRect();
        const imgAspectRatio = image.naturalWidth / image.naturalHeight;
        const containerAspectRatio = width / height;

        let renderWidth, renderHeight;
        if (imgAspectRatio > containerAspectRatio) {
          renderWidth = width;
          renderHeight = width / imgAspectRatio;
        } else {
          renderHeight = height;
          renderWidth = height * imgAspectRatio;
        }

        imageCanvas.width = renderWidth;
        imageCanvas.height = renderHeight;
        drawingCanvas.width = renderWidth;
        drawingCanvas.height = renderHeight;
        
        ctx.drawImage(image, 0, 0, renderWidth, renderHeight);
        clearCanvas(); // Clear drawing canvas when new image loads
      }
    };
  }, [imageUrl, clearCanvas]);

  const getCoords = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  const startDrawing = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const coords = getCoords(e);
    lastPoint.current = coords;
  }, [getCoords]);

  const draw = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (!ctx || !lastPoint.current) return;
    
    const coords = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)'; // Semi-transparent red
    ctx.lineWidth = brushSize;
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
    const drawingCanvas = drawingCanvasRef.current;
    if (drawingCanvas) {
      onMaskChange(drawingCanvas.toDataURL('image/png'));
    }
  }, [isDrawing, onMaskChange]);

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <canvas ref={imageCanvasRef} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
      <canvas
        ref={drawingCanvasRef}
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-crosshair"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      />
    </div>
  );
};