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

export interface DodgeBurnSettings {
  tool: 'dodge' | 'burn';
  size: number;
  opacity: number;
  hardness: number;
}

export type AdjustmentLayerSettings = HSLAdjustment[] | LevelsAdjustment;

export interface AdjustmentLayer {
  id: string;
  name: string;
  type: 'hsl' | 'levels';
  visible: boolean;
  settings: AdjustmentLayerSettings;
}

export interface PaintLayer {
    id: string;
    name: string;
    type: 'dodge-burn';
    visible: boolean;
    settings: DodgeBurnSettings;
    // This layer will have its own canvas, which will be managed in the component state
}

// A layer can be an adjustment or a paint layer
export type Layer = AdjustmentLayer | PaintLayer;