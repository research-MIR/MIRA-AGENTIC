export interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed' | 'compositing' | 'delegated' | 'pending' | 'segmenting';
  source_person_image_url?: string;
  source_garment_image_url?: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'inpaint';
  created_at: string;
  batch_pair_job_id?: string;
  metadata?: {
    debug_assets?: any;
    prompt_used?: string;
    source_image_url?: string;
    reference_image_url?: string;
  }
}