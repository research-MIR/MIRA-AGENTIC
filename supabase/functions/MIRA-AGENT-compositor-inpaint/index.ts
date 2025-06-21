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

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array, userId: string, filename: string): Promise<string> {
    const filePath = `${userId}/vto-debug/${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) throw new Error(`Storage upload failed for ${filename}: ${error.message}`);
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
    if (!job.metadata?.full_source_image_base64 || !job.metadata?.bbox || !job.metadata?.cropped_dilated_mask_base64 || !job.metadata?.cropped_source_image_base64) {
      throw new Error("Job is missing necessary metadata for compositing.");
    }

    const { createCanvas, loadImage } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
    
    // 1. Load all necessary images from metadata and temporary URL
    const fullSourceImage = await loadImage(`data:image/png;base64,${job.metadata.full_source_image_base64}`);
    const inpaintedCropResponse = await fetch(job.final_image_url);
    if (!inpaintedCropResponse.ok) throw new Error("Failed to download inpainted crop from BitStudio.");
    const inpaintedCropImage = await loadImage(new Uint8Array(await inpaintedCropResponse.arrayBuffer()));

    // 2. Perform the final composition
    const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
    const ctx = canvas.getContext('2d');
    ctx.drawImage(fullSourceImage, 0, 0);
    ctx.drawImage(inpaintedCropImage, job.metadata.bbox.x, job.metadata.bbox.y, job.metadata.bbox.width, job.metadata.bbox.height);
    const finalImageBuffer = canvas.toBuffer('image/png');

    // 3. Upload all assets to our permanent storage
    const [
        finalCompositedUrl,
        croppedSourceUrl,
        dilatedMaskUrl,
        inpaintedCropUrl
    ] = await Promise.all([
        uploadBufferToStorage(supabase, finalImageBuffer, job.user_id, 'final_composite.png'),
        uploadBufferToStorage(supabase, decodeBase64(job.metadata.cropped_source_image_base64), job.user_id, 'cropped_source.png'),
        uploadBufferToStorage(supabase, decodeBase64(job.metadata.cropped_dilated_mask_base64), job.user_id, 'dilated_mask.png'),
        uploadBufferToStorage(supabase, new Uint8Array(await inpaintedCropResponse.clone().arrayBuffer()), job.user_id, 'inpainted_crop.png')
    ]);

    // 4. Assemble the final debug assets object with permanent URLs
    const debug_assets = {
        cropped_source_url: croppedSourceUrl,
        dilated_mask_url: dilatedMaskUrl,
        inpainted_crop_url: inpaintedCropUrl,
        final_composited_url: finalCompositedUrl
    };

    // 5. Update the job with the final, composited URL and mark as complete
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