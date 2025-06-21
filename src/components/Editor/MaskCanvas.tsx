import React, { useRef, useEffect, useState } from 'react';

interface MaskCanvasProps {
  imageUrl: string;
  onMaskChange: (dataUrl: string) => void;
}

export const MaskCanvas = ({ imageUrl, onMaskChange }: MaskCanvasProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  // Effect to draw the base image
  useEffect(() => {
    const imageCanvas = imageCanvasRef.current;
    const drawingCanvas = drawingCanvasRef.current;
    if (!imageCanvas || !drawingCanvas) return;
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
      }
    };
  }, [imageUrl]);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const coords = getCoords(e);
    lastPoint.current = coords;
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = drawingCanvasRef.current?.getContext('2d');
    if (!ctx || !lastPoint.current) return;
    
    const coords = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 30;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.closePath();
    lastPoint.current = coords;
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    lastPoint.current = null;
    const drawingCanvas = drawingCanvasRef.current;
    if (drawingCanvas) {
      onMaskChange(drawingCanvas.toDataURL('image/png'));
    }
  };

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