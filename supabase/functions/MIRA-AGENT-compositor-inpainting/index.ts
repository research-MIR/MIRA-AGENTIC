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
    if (!metadata.full_source_image_base64 || !metadata.bbox) {
      throw new Error("Job is missing essential metadata (full source image or bounding box) for compositing.");
    }

    const fullSourceImage = await loadImage(`data:image/png;base64,${metadata.full_source_image_base64}`);
    const inpaintedCropResponse = await fetch(job.final_result.publicUrl);
    if (!inpaintedCropResponse.ok) throw new Error(`Failed to download inpainted crop from ComfyUI: ${inpaintedCropResponse.statusText}`);
    const inpaintedCropImage = await loadImage(await inpaintedCropResponse.arrayBuffer());

    const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(fullSourceImage, 0, 0);
    ctx.drawImage(inpaintedCropImage, metadata.bbox.x, metadata.bbox.y, metadata.bbox.width, metadata.bbox.height);
    
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
          metadata: { ...metadata, full_source_image_base64: null } // Clear large data
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