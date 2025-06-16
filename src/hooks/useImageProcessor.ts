import { useEffect } from 'react';
import { Layer, HSLAdjustment, LevelsAdjustment } from '@/types/editor';
import { rgbToHsl, hslToRgb } from '@/lib/colorUtils';

const applyHsl = (imageData: ImageData, settings: HSLAdjustment[]) => {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);

    const master = settings.find(s => s.range === 'master')!;
    let adjustments: HSLAdjustment[] = [master];

    if (h >= 330 || h < 30) adjustments.push(settings.find(s => s.range === 'reds')!);
    if (h >= 30 && h < 90) adjustments.push(settings.find(s => s.range === 'yellows')!);
    if (h >= 90 && h < 150) adjustments.push(settings.find(s => s.range === 'greens')!);
    if (h >= 150 && h < 210) adjustments.push(settings.find(s => s.range === 'cyans')!);
    if (h >= 210 && h < 270) adjustments.push(settings.find(s => s.range === 'blues')!);
    if (h >= 270 && h < 330) adjustments.push(settings.find(s => s.range === 'magentas')!);

    adjustments.forEach(adj => {
      if (!adj) return;
      h = (h + adj.hue + 360) % 360;
      s = Math.max(0, Math.min(1, s + adj.saturation / 100));
      l = Math.max(0, Math.min(1, l + adj.lightness / 100));
    });

    const [r, g, b] = hslToRgb(h, s, l);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
  }
};

const applyLevels = (imageData: ImageData, settings: LevelsAdjustment) => {
  const d = imageData.data;
  const inRange = settings.inWhite - settings.inBlack;
  const outRange = settings.outWhite - settings.outBlack;
  
  const levels = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    if (i <= settings.inBlack) {
      levels[i] = settings.outBlack;
    } else if (i >= settings.inWhite) {
      levels[i] = settings.outWhite;
    } else {
      const val = (i - settings.inBlack) / inRange;
      const corrected = Math.pow(val, settings.inGamma);
      levels[i] = Math.round(corrected * outRange + settings.outBlack);
    }
  }

  for (let i = 0; i < d.length; i += 4) {
    d[i] = levels[d[i]];
    d[i + 1] = levels[d[i + 1]];
    d[i + 2] = levels[d[i + 2]];
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
        case 'hsl':
          applyHsl(imageData, layer.settings as HSLAdjustment[]);
          break;
        case 'levels':
          applyLevels(imageData, layer.settings as LevelsAdjustment);
          break;
      }
    });

    ctx.putImageData(imageData, 0, 0);

  }, [baseImage, layers, canvasRef]);
};