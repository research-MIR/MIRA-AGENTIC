export interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'done' | 'failed' | 'compositing' | 'delegated' | 'pending' | 'segmenting' | 'permanently_failed' | 'awaiting_fix' | 'fixing';
  source_person_image_url?: string;
  source_garment_image_url?: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'inpaint';
  created_at: string;
  updated_at: string;
  batch_pair_job_id?: string;
  metadata?: {
    debug_assets?: any;
    prompt_used?: string;
    source_image_url?: string;
    reference_image_url?: string;
    qa_history?: any[];
    fix_history?: any[]; // To store detailed fix attempts
    current_fix_plan?: any;
    verification_result?: {
      is_match: boolean;
      confidence_score: number;
      mismatch_reason: string | null;
      fix_suggestion: string | null;
      error?: string;
    };
    outfit_analysis_skipped?: boolean;
    outfit_analysis_error?: string;
    outfit_completeness_analysis?: {
      is_outfit_complete: boolean;
      missing_items: string[];
      reasoning: string;
      vto_garment_type: string;
    };
  };
}

export interface PoseAnalysis {
  shoot_focus: 'upper_body' | 'lower_body' | 'full_body';
  garment: {
    description: string;
    coverage: 'upper_body' | 'lower_body' | 'full_body' | 'shoes';
    is_identical_to_base_garment: boolean;
  };
}

export interface Pose {
  final_url: string;
  is_upscaled?: boolean;
  status: string;
  pose_prompt: string;
  jobId: string;
  analysis?: PoseAnalysis;
  comfyui_prompt_id?: string;
}

export interface AnalyzedGarment {
  file?: File;
  previewUrl: string;
  analysis: {
    intended_gender: 'male' | 'female' | 'unisex';
    type_of_fit: 'upper_body' | 'lower_body' | 'full_body' | 'shoes';
    [key: string]: any;
  } | null;
  isAnalyzing: boolean;
  hash?: string;
}