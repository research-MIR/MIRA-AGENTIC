export interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed' | 'compositing' | 'delegated' | 'pending' | 'segmenting' | 'permanently_failed' | 'awaiting_fix' | 'fixing';
  source_person_image_url?: string;
  source_garment_image_url?: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'inpaint';
  created_at: string;
  batch_pair_job_id?: string;
  metadata?: {
    debug_assets?: {
      raw_mask_url?: string;
      expanded_mask_url?: string;
      vtoned_crop_url?: string;
      feathered_patch_url?: string;
      compositing_bbox?: { x: number; y: number; width: number; height: number; };
    };
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
    }
  };
}