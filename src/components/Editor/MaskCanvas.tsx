import React, { useRef, useEffect, useState } from 'react';

interface MaskCanvasProps {
  imageUrl: string;
  onMaskChange: (dataUrl: string) => void;
}

export const MaskCanvas = ({ imageUrl, onMaskChange }: MaskCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = imageUrl;
    image.onload = () => {
      const container = canvas.parentElement;
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

        canvas.width = renderWidth;
        canvas.height = renderHeight;
        
        ctx.drawImage(image, 0, 0, renderWidth, renderHeight);
      }
    };
  }, [imageUrl]);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
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
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    setIsDrawing(true);
    const { x, y } = getCoords(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const { x, y } = getCoords(e);
    ctx.lineTo(x, y);
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 30;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    const canvas = canvasRef.current;
    if (!canvas || !isDrawing) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.closePath();
    setIsDrawing(false);
    onMaskChange(canvas.toDataURL('image/png'));
  };

  return (
    <div className="relative w-full aspect-square bg-muted rounded-md flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className="cursor-crosshair"
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