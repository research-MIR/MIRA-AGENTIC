export interface Mask {
  imageData: ImageData;
  enabled: boolean;
}

export interface HueSaturationSettings {
  hue: number;
  saturation: number;
  lightness: number;
}

export interface LevelsSettings {
  inputShadow: number;
  inputMidtone: number;
  inputHighlight: number;
  outputShadow: number;
  outputHighlight: number;
}

export interface CurvesSettings {
  points: { x: number; y: number }[];
  channel: 'rgb' | 'r' | 'g' | 'b';
}

export interface NoiseSettings {
  type: 'perlin'; // For now, we'll start with one advanced type
  scale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  seed: number;
  monochromatic: boolean;
}

export type BlendMode = 
  | 'normal' 
  | 'multiply' 
  | 'screen' 
  | 'overlay' 
  | 'soft-light' 
  | 'hard-light' 
  | 'color-dodge' 
  | 'color-burn' 
  | 'difference' 
  | 'exclusion' 
  | 'hue' 
  | 'saturation' 
  | 'color' 
  | 'luminosity';

export interface AdjustmentLayer {
  id: string;
  name: string;
  type: 'hue-saturation' | 'curves' | 'levels' | 'noise';
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  settings: HueSaturationSettings | CurvesSettings | LevelsSettings | NoiseSettings;
  mask: Mask;
}

// This allows for different types of layers in the future, e.g., image layers
export type Layer = AdjustmentLayer;