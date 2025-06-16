export interface AdjustmentLayer {
  id: string;
  name: string;
  type: 'saturation' | 'curves' | 'lut';
  visible: boolean;
  settings: any;
}

// This allows for different types of layers in the future, e.g., image layers
export type Layer = AdjustmentLayer;