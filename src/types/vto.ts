export interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed' | 'compositing' | 'delegated';
  source_person_image_url?: string;
  source_garment_image_url?: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'inpaint';
  metadata?: {
    debug_assets?: any;
    prompt_used?: string;
    source_image_url?: string;
    reference_image_url?: string;
  }
}