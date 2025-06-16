export interface HSLAdjustment {
  range: 'master' | 'reds' | 'yellows' | 'greens' | 'cyans' | 'blues' | 'magentas';
  hue: number; // -180 to 180
  saturation: number; // -100 to 100
  lightness: number; // -100 to 100
}

export interface LevelsAdjustment {
  inBlack: number; // 0-255
  inWhite: number; // 0-255
  inGamma: number; // 0.1-10
  outBlack: number; // 0-255
  outWhite: number; // 0-255
}

export interface AdjustmentLayer {
  id: string;
  name: string;
  type: 'hsl' | 'levels';
  visible: boolean;
  settings: HSLAdjustment[] | LevelsAdjustment;
}

// This allows for different types of layers in the future, e.g., image layers
export type Layer = AdjustmentLayer;