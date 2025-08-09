export type VtoMode = "oneToMany" | "precisePairs" | "randomPairs";

export interface ModelPose {
  id: string;
  name: string;
  pack: string;
  gender: "male" | "female" | "unisex";
  thumbUrl: string;
  analysis?: any;
  final_url: string;
}

export interface Garment {
  id: string;
  name: string;
  category: string;
  fit: "slim" | "regular" | "oversize";
  intendedGender: "male" | "female" | "unisex";
  imageUrl: string;
  analysis?: any;
}

export interface PairInput {
  model: ModelPose;
  garment: Garment;
  notes?: string;
}

export interface GenerationSettings {
  engine: 'google' | 'bitstudio';
  aspectRatio: string;
  cropMode: 'contain' | 'cover' | 'smart';
  strictCompatibility: boolean;
  autoCompleteOutfit: boolean;
  retryPolicy: { maxRetries: number; backoffMs: number };
}

export interface OrchestratorPayload {
  userId: string;
  mode: VtoMode;
  pairs: PairInput[];
  settings: GenerationSettings;
  tags?: string[];
}

export interface PackSummary {
  id: string;
  name: string;
  createdAt: string;
  total: number;
  success: number;
  failed: number;
  inProgress: number;
  hasReport: boolean;
}