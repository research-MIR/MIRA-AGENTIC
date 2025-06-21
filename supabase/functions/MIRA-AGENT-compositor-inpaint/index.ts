import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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

  try {
    const { job_id } = await req.json();
    if (!job_id) throw new Error("job_id is required.");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('final_image_url, metadata, user_id')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    if (!job.final_image_url) throw new Error("Job is missing the final_image_url (inpainted crop).");
    if (!job.metadata?.full_source_image_base64 || !job.metadata?.bbox) {
      throw new Error("Job is missing necessary metadata for compositing (full source image or bbox).");
    }

    const { createCanvas, loadImage } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
    
    const fullSourceImage = await loadImage(`data:image/png;base64,${job.metadata.full_source_image_base64}`);
    const inpaintedCropResponse = await fetch(job.final_image_url);
    if (!inpaintedCropResponse.ok) throw new Error("Failed to download inpainted crop from BitStudio.");
    const inpaintedCropImage = await loadImage(await inpaintedCropResponse.arrayBuffer());

    const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
    const ctx = canvas.getContext('2d');

    ctx.drawImage(fullSourceImage, 0, 0);
    ctx.drawImage(inpaintedCropImage, job.metadata.bbox.x, job.metadata.bbox.y, job.metadata.bbox.width, job.metadata.bbox.height);

    const finalImageBuffer = canvas.toBuffer('image/png');
    
    const filePath = `${job.user_id}/inpainted/${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, finalImageBuffer, { contentType: 'image/png', upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

    // Update the job with the final, composited URL
    await supabase.from('mira-agent-bitstudio-jobs')
      .update({ final_image_url: publicUrl })
      .eq('id', job_id);

    return new Response(JSON.stringify({ success: true, finalImageUrl: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[Compositor] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});