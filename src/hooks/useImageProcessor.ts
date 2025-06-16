import { useEffect, useMemo } from 'react';
import { Layer, HueSaturationSettings, LevelsSettings, CurvesSettings, NoiseSettings } from '@/types/editor';
import { createNoise2D } from 'simplex-noise';

// --- Color Conversion Helpers ---
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r, g, b;
  h /= 360;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

// --- Adjustment Functions ---
const applyHueSaturation = (imageData: ImageData, settings: HueSaturationSettings) => {
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const newH = (h + settings.hue) % 360;
    const newS = Math.max(0, Math.min(1, s * settings.saturation));
    const newL = Math.max(0, Math.min(1, l + settings.lightness));
    const [r, g, b] = hslToRgb(newH < 0 ? newH + 360 : newH, newS, newL);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
};

const applyLevels = (imageData: ImageData, settings: LevelsSettings) => {
  const d = imageData.data;
  const lut = new Uint8ClampedArray(256);
  const gamma = settings.inputMidtone;
  for (let i = 0; i < 256; i++) {
    let val = (i - settings.inputShadow) * (1 / (settings.inputHighlight - settings.inputShadow));
    val = Math.pow(val, 1 / gamma);
    val = val * (settings.outputHighlight - settings.outputShadow) + settings.outputShadow;
    lut[i] = val;
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
};

const applyCurves = (imageData: ImageData, settings: CurvesSettings) => {
  const d = imageData.data;
  const lut = new Uint8ClampedArray(256);
  const sortedPoints = [...settings.points].sort((a, b) => a.x - b.x);
  
  let p1 = sortedPoints[0];
  let p2 = sortedPoints[1];
  let pointIndex = 1;

  for (let i = 0; i < 256; i++) {
    if (i > p2.x && pointIndex < sortedPoints.length - 1) {
      p1 = sortedPoints[pointIndex];
      p2 = sortedPoints[pointIndex + 1];
      pointIndex++;
    }
    const t = (p2.x - p1.x) > 0 ? (i - p1.x) / (p2.x - p1.x) : 0;
    lut[i] = p1.y + t * (p2.y - p1.y);
  }

  for (let i = 0; i < d.length; i += 4) {
    switch(settings.channel) {
        case 'r': d[i] = lut[d[i]]; break;
        case 'g': d[i+1] = lut[d[i+1]]; break;
        case 'b': d[i+2] = lut[d[i+2]]; break;
        case 'rgb': default: d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; break;
    }
  }
};

const applyNoise = (imageData: ImageData, settings: NoiseSettings) => {
  const { width, height, data } = imageData;
  const noise2D = createNoise2D(() => settings.seed);
  const noiseR = createNoise2D(() => settings.seed + 1);
  const noiseG = createNoise2D(() => settings.seed + 2);
  const noiseB = createNoise2D(() => settings.seed + 3);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let total = 0;
      let frequency = 1;
      let amplitude = 1;
      let maxValue = 0;

      for (let i = 0; i < settings.octaves; i++) {
        total += noise2D(x * frequency / settings.scale, y * frequency / settings.scale) * amplitude;
        maxValue += amplitude;
        amplitude *= settings.persistence;
        frequency *= settings.lacunarity;
      }

      const normalizedValue = (total / maxValue + 1) / 2; // Map from [-1, 1] to [0, 1]
      const noiseValue = normalizedValue * 255;

      const index = (y * width + x) * 4;
      if (settings.monochromatic) {
        data[index] = noiseValue;
        data[index + 1] = noiseValue;
        data[index + 2] = noiseValue;
      } else {
        data[index] = (noiseR(x / settings.scale, y / settings.scale) + 1) / 2 * 255;
        data[index + 1] = (noiseG(x / settings.scale, y / settings.scale) + 1) / 2 * 255;
        data[index + 2] = (noiseB(x / settings.scale, y / settings.scale) + 1) / 2 * 255;
      }
      data[index + 3] = 255; // Alpha
    }
  }
};

export const useImageProcessor = (
  baseImage: HTMLImageElement | null,
  layers: Layer[]
): HTMLCanvasElement | null => {
  const processedCanvas = useMemo(() => {
    if (!baseImage) return null;

    const canvas = document.createElement('canvas');
    canvas.width = baseImage.naturalWidth;
    canvas.height = baseImage.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(baseImage, 0, 0);

    if (layers.length === 0) return canvas;

    layers.slice().reverse().forEach(layer => {
      if (!layer.visible) return;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
      if (!tempCtx) return;

      const layerImageData = tempCtx.createImageData(canvas.width, canvas.height);

      switch (layer.type) {
        case 'hue-saturation':
          tempCtx.drawImage(canvas, 0, 0);
          const hsData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
          applyHueSaturation(hsData, layer.settings as HueSaturationSettings);
          tempCtx.putImageData(hsData, 0, 0);
          break;
        case 'levels':
          tempCtx.drawImage(canvas, 0, 0);
          const levelsData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
          applyLevels(levelsData, layer.settings as LevelsSettings);
          tempCtx.putImageData(levelsData, 0, 0);
          break;
        case 'curves':
          tempCtx.drawImage(canvas, 0, 0);
          const curvesData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
          applyCurves(curvesData, layer.settings as CurvesSettings);
          tempCtx.putImageData(curvesData, 0, 0);
          break;
        case 'noise':
          applyNoise(layerImageData, layer.settings as NoiseSettings);
          tempCtx.putImageData(layerImageData, 0, 0);
          break;
      }
      
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(tempCanvas, 0, 0);
      
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1.0;
    });

    return canvas;
  }, [baseImage, layers]);

  return processedCanvas;
};