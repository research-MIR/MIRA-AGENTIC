import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array | null, userId: string, filename: string): Promise<string | null> {
    if (!buffer) return null;
    const filePath = `${userId}/vto-debug/${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) {
        console.error(`Storage upload failed for ${filename}: ${error.message}`);
        return null; // Return null on failure instead of throwing
    }
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return publicUrl;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('final_image_url, metadata, user_id')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    if (!job.final_image_url) throw new Error("Job is missing the final_image_url (inpainted crop).");

    const metadata = job.metadata || {};
    
    if (!metadata.full_source_image_base64 || !metadata.bbox) {
      console.error(`[Compositor][${job_id}] CRITICAL ERROR: Missing essential metadata. Has full source: ${!!metadata.full_source_image_base64}, Has bbox: ${!!metadata.bbox}`);
      throw new Error("Job is missing essential metadata (full source image or bounding box) for compositing.");
    }

    const { createCanvas, loadImage } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
    
    const fullSourceImage = await loadImage(`data:image/png;base64,${job.metadata.full_source_image_base64}`);
    const inpaintedCropResponse = await fetch(job.final_image_url);
    if (!inpaintedCropResponse.ok) throw new Error("Failed to download inpainted crop from BitStudio.");
    
    const inpaintedCropArrayBuffer = await inpaintedCropResponse.arrayBuffer();
    const inpaintedCropImage = await loadImage(new Uint8Array(inpaintedCropArrayBuffer));

    const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
    const ctx = canvas.getContext('2d');
    ctx.drawImage(fullSourceImage, 0, 0);
    
    // This is the key change: we draw the (potentially larger) inpainted image
    // into the original bounding box area. The canvas API handles the downscaling
    // to fit, preserving the detail within the original dimensions.
    ctx.drawImage(inpaintedCropImage, job.metadata.bbox.x, job.metadata.bbox.y, job.metadata.bbox.width, job.metadata.bbox.height);
    
    const finalImageBuffer = canvas.toBuffer('image/png');

    const croppedSourceBuffer = metadata.cropped_source_image_base64 ? decodeBase64(metadata.cropped_source_image_base64) : null;
    const dilatedMaskBuffer = metadata.cropped_dilated_mask_base64 ? decodeBase64(metadata.cropped_dilated_mask_base64) : null;
    const inpaintedCropBuffer = new Uint8Array(inpaintedCropArrayBuffer);

    const [
        finalCompositedUrl,
        croppedSourceUrl,
        dilatedMaskUrl,
        inpaintedCropUrl
    ] = await Promise.all([
        uploadBufferToStorage(supabase, finalImageBuffer, job.user_id, 'final_composite.png'),
        uploadBufferToStorage(supabase, croppedSourceBuffer, job.user_id, 'cropped_source.png'),
        uploadBufferToStorage(supabase, dilatedMaskBuffer, job.user_id, 'dilated_mask.png'),
        uploadBufferToStorage(supabase, inpaintedCropBuffer, job.user_id, 'inpainted_crop.png')
    ]);

    if (!finalCompositedUrl) {
        throw new Error("Failed to upload the final composited image to storage.");
    }

    const debug_assets = {
        cropped_source_url: croppedSourceUrl,
        dilated_mask_url: dilatedMaskUrl,
        inpainted_crop_url: inpaintedCropUrl,
        final_composited_url: finalCompositedUrl
    };

    await supabase.from('mira-agent-bitstudio-jobs')
      .update({ 
          final_image_url: finalCompositedUrl,
          status: 'complete',
          metadata: { ...job.metadata, debug_assets }
      })
      .eq('id', job_id);

    return new Response(JSON.stringify({ success: true, finalImageUrl: finalCompositedUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Compositor][${job_id}] Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Compositor failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});