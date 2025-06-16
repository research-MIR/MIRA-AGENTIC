import { useEffect } from 'react';
import { Layer } from '@/types/editor';

const applySaturation = (imageData: ImageData, level: number) => {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const diff = max - min;
      s = l > 127.5 ? diff / (510 - max - min) : diff / (max + min);
      // Hue calculation is complex and not needed for saturation adjustment
    }
    
    s *= level;
    s = Math.max(0, Math.min(1, s));

    if (s === 0) {
      d[i] = d[i + 1] = d[i + 2] = l;
    } else {
      const temp2 = l < 127.5 ? l * (1 + s) : l + s - l * s;
      const temp1 = 2 * l - temp2;
      // Simplified RGB conversion from HSL, as hue is constant
      const tR = max / 255;
      const tG = g / 255;
      const tB = b / 255;
      
      // This is a simplification. A full HSL->RGB conversion is needed for perfect accuracy.
      // For now, we'll use a simpler method: lerp towards grayscale
      const gray = r * 0.3 + g * 0.59 + b * 0.11;
      d[i] = gray + (r - gray) * level;
      d[i+1] = gray + (g - gray) * level;
      d[i+2] = gray + (b - gray) * level;
    }
  }
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

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    layers.forEach(layer => {
      if (!layer.visible) return;

      switch (layer.type) {
        case 'saturation':
          applySaturation(imageData, layer.settings.saturation);
          break;
        // other cases for curves, luts etc.
      }
    });

    ctx.putImageData(imageData, 0, 0);

  }, [baseImage, layers, canvasRef]);
};