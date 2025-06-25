import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[Compositor-Inpainting][${job_id}] Job started.`);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-inpainting-jobs')
      .select('final_result, metadata, user_id')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    if (!job.final_result?.publicUrl) throw new Error("Job is missing the final_result URL (inpainted crop).");

    const metadata = job.metadata || {};
    if (!metadata.full_source_image_base64 || !metadata.bbox || !metadata.cropped_dilated_mask_base64) {
      throw new Error("Job is missing essential metadata (source image, bbox, or mask) for compositing.");
    }

    const fullSourceImage = await loadImage(`data:image/png;base64,${metadata.full_source_image_base64}`);
    const inpaintedCropResponse = await fetch(job.final_result.publicUrl);
    if (!inpaintedCropResponse.ok) throw new Error(`Failed to download inpainted crop from ComfyUI: ${inpaintedCropResponse.statusText}`);
    const inpaintedCropArrayBuffer = await inpaintedCropResponse.arrayBuffer();
    const inpaintedCropImage = await loadImage(new Uint8Array(inpaintedCropArrayBuffer));
    const croppedMaskImage = await loadImage(`data:image/png;base64,${metadata.cropped_dilated_mask_base64}`);

    // Main canvas for the final image
    const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
    const ctx = canvas.getContext('2d');

    // 1. Draw the original image as the base layer
    ctx.drawImage(fullSourceImage, 0, 0);

    // 2. Create a temporary canvas for the feathered crop
    const featheredCropCanvas = createCanvas(metadata.bbox.width, metadata.bbox.height);
    const featheredCtx = featheredCropCanvas.getContext('2d');

    // 3. Draw the inpainted crop onto the temp canvas
    featheredCtx.drawImage(inpaintedCropImage, 0, 0, metadata.bbox.width, metadata.bbox.height);

    // 4. Apply the mask with feathering
    featheredCtx.globalCompositeOperation = 'destination-in';

    // 5. Feather the mask by blurring it
    const featherAmount = Math.max(5, Math.round(metadata.bbox.width * 0.05)); // Feather by 5% of width, with a minimum of 5px
    featheredCtx.filter = `blur(${featherAmount}px)`;

    // 6. Draw the mask onto the temp canvas. This will use the blur filter and the composite operation
    // to create a feathered alpha channel on the inpainted crop.
    featheredCtx.drawImage(croppedMaskImage, 0, 0, metadata.bbox.width, metadata.bbox.height);

    // 7. Reset composite operation and filter for the main canvas
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none'; // Reset filter on the main context just in case

    // 8. Draw the feathered crop onto the main canvas at the correct position
    ctx.drawImage(featheredCropCanvas, metadata.bbox.x, metadata.bbox.y);
    
    const finalImageBuffer = canvas.toBuffer('image/png');
    const finalFilePath = `${job.user_id}/inpainting-final/${Date.now()}_final.png`;
    
    const { error: uploadError } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(finalFilePath, finalImageBuffer, { contentType: 'image/png', upsert: true });
    if (uploadError) throw uploadError;

    const { data: { publicUrl: finalPublicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);

    await supabase.from('mira-agent-inpainting-jobs')
      .update({ 
          status: 'complete',
          final_result: { publicUrl: finalPublicUrl, storagePath: finalFilePath },
          metadata: { ...metadata, full_source_image_base64: null, cropped_dilated_mask_base64: null } // Clear large data
      })
      .eq('id', job_id);

    console.log(`[Compositor-Inpainting][${job_id}] Compositing complete. Final URL: ${finalPublicUrl}`);
    return new Response(JSON.stringify({ success: true, finalImageUrl: finalPublicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Compositor-Inpainting][${job_id}] Error:`, error);
    await supabase.from('mira-agent-inpainting-jobs').update({ status: 'failed', error_message: `Compositor failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});