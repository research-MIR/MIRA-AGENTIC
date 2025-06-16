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

export interface AdjustmentLayer {
  id: string;
  name: string;
  type: 'hue-saturation' | 'curves' | 'levels';
  visible: boolean;
  opacity: number;
  settings: HueSaturationSettings | CurvesSettings | LevelsSettings;
  mask: Mask;
}

// This allows for different types of layers in the future, e.g., image layers
export type Layer = AdjustmentLayer;