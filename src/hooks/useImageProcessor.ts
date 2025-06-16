import { useEffect } from 'react';
import { Layer } from '@/types/editor';

const applyHueSaturation = (imageData: ImageData, level: number) => {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    
    const gray = r * 0.3 + g * 0.59 + b * 0.11;
    d[i] = gray + (r - gray) * level;
    d[i+1] = gray + (g - gray) * level;
    d[i+2] = gray + (b - gray) * level;
  }
};

// Placeholder for Levels adjustment
const applyLevels = (imageData: ImageData, settings: any) => {
  // This is where the levels logic will go
};

// Placeholder for Curves adjustment
const applyCurves = (imageData: ImageData, settings: any) => {
  // This is where the curves logic will go
};


export const useImageProcessor = (
  baseImage: HTMLImageElement | null,
  layers: Layer[],
  canvasRef: React.RefObject<HTMLCanvasElement>
) => {
  useEffect(() => {
    if (!baseImage || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = baseImage.naturalWidth;
    canvas.height = baseImage.naturalHeight;

    ctx.drawImage(baseImage, 0, 0);

    if (layers.length === 0) return;

    const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    layers.slice().reverse().forEach(layer => {
      if (!layer.visible) return;

      // Create a temporary canvas for the current layer's effect
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      if (!tempCtx) return;

      // Get the current state of the main canvas
      const currentImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      tempCtx.putImageData(currentImageData, 0, 0);
      const layerImageData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);

      switch (layer.type) {
        case 'hue-saturation':
          applyHueSaturation(layerImageData, (layer.settings as any).saturation);
          break;
        case 'levels':
          applyLevels(layerImageData, layer.settings);
          break;
        case 'curves':
          applyCurves(layerImageData, layer.settings);
          break;
      }
      
      // For now, we just put the data back. Masking logic will be added here.
      ctx.putImageData(layerImageData, 0, 0);
    });

  }, [baseImage, layers, canvasRef]);
};