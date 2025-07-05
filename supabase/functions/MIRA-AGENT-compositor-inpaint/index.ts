import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

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

  const { job_id, final_image_url, job_type = 'comfyui' } = await req.json();
  if (!job_id || !final_image_url) throw new Error("job_id and final_image_url are required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[Compositor-Inpainting][${job_id}] Job started. Type: ${job_type}`);

  try {
    let job, fetchError;
    const tableName = job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs';
    const selectColumns = 'metadata, user_id';

    console.log(`[Compositor-Inpainting][${job_id}] Fetching from table: ${tableName}`);
    
    ({ data: job, error: fetchError } = await supabase
      .from(tableName)
      .select(selectColumns)
      .eq('id', job_id)
      .single());

    if (fetchError) throw fetchError;
    
    const metadata = job.metadata || {};
    if (!metadata.full_source_image_base64 || !metadata.bbox || !metadata.cropped_dilated_mask_base64) {
      throw new Error("Job is missing essential metadata (source image, bbox, or mask) for compositing.");
    }

    const fullSourceBuffer = decodeBase64(metadata.full_source_image_base64);
    const fullSourceImage = await loadImage(fullSourceBuffer);

    const inpaintedCropResponse = await fetch(final_image_url);
    if (!inpaintedCropResponse.ok) throw new Error(`Failed to download inpainted crop: ${inpaintedCropResponse.statusText}`);
    const inpaintedCropArrayBuffer = await inpaintedCropResponse.arrayBuffer();
    const inpaintedCropImage = await loadImage(new Uint8Array(inpaintedCropArrayBuffer));

    const croppedMaskBuffer = decodeBase64(metadata.cropped_dilated_mask_base64);
    const croppedMaskImage = await loadImage(croppedMaskBuffer);

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

    const finalResultPayload = { publicUrl: finalPublicUrl, storagePath: finalFilePath };
    const finalMetadata = { ...metadata, full_source_image_base64: null, cropped_dilated_mask_base64: null };

    if (job_type === 'bitstudio') {
        await supabase.from('mira-agent-bitstudio-jobs')
          .update({ 
              status: 'complete',
              final_image_url: finalPublicUrl,
              metadata: finalMetadata
          })
          .eq('id', job_id);
    } else { // comfyui
        await supabase.from('mira-agent-inpainting-jobs')
          .update({ 
              status: 'complete',
              final_result: finalResultPayload,
              metadata: finalMetadata
          })
          .eq('id', job_id);
    }

    console.log(`[Compositor-Inpainting][${job_id}] Compositing complete. Final URL: ${finalPublicUrl}`);
    return new Response(JSON.stringify({ success: true, finalImageUrl: finalPublicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Compositor-Inpainting][${job_id}] Error:`, error);
    const tableName = job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs';
    await supabase.from(tableName).update({ status: 'failed', error_message: `Compositor failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});