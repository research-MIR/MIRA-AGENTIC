import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const FAL_KEY = Deno.env.get('FAL_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-agent-upscale-tiles';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { tile_id } = await req.json();
  if (!tile_id) {
    return new Response(JSON.stringify({ error: "tile_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TileGeneratorWorker][${tile_id}]`;

  try {
    const { data: claimedTile, error: claimError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ status: 'generating' })
      .eq('id', tile_id)
      .eq('status', 'pending_generation')
      .not('generated_prompt', 'is', null)
      .select('id, parent_job_id, source_tile_bucket, source_tile_path, generated_prompt')
      .single();

    if (claimError) throw new Error(`Claiming tile failed: ${claimError.message}`);
    if (!claimedTile) {
      console.log(`${logPrefix} Tile already claimed, not in 'pending_generation' state, or missing prompt. Exiting.`);
      return new Response(JSON.stringify({ success: true, message: "Tile not eligible for generation." }), { headers: corsHeaders });
    }

    const { parent_job_id, source_tile_bucket, source_tile_path, generated_prompt } = claimedTile;

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(source_tile_bucket)
      .createSignedUrl(source_tile_path, 300); // 5 minute validity
    if (signedUrlError) throw signedUrlError;

    fal.config({ credentials: FAL_KEY! });

    const falInput = {
        model_type: "SDXL",
        image_url: signedUrlData.signedUrl,
        prompt: generated_prompt,
        scale: 2,
        creativity: 0.045,
        detail: 2.5,
        shape_preservation: 2.5,
        prompt_suffix: " high quality, highly detailed, high resolution, sharp",
        negative_prompt: "blurry, low resolution, bad, ugly, low quality, pixelated, interpolated, compression artifacts, noisey, grainy",
        seed: Math.floor(Math.random() * 1000000000),
        guidance_scale: 7.5,
        num_inference_steps: 20,
        enable_safety_checks: false,
        additional_lora_scale: 1,
        base_model_url: "https://huggingface.co/RunDiffusion/Juggernaut-XL-v9/resolve/main/Juggernaut-XL_v9_RunDiffusionPhoto_v2.safetensors",
        additional_lora_url: "https://civitai.com/api/download/models/532451?type=Model&format=SafeTensor",
    };

    const result: any = await fal.subscribe("fal-ai/creative-upscaler", {
      input: falInput,
      logs: true,
    });

    // Handle both potential output formats from Fal.ai for resilience
    let upscaledImage;
    if (result?.image) {
        // New creative-upscaler format
        upscaledImage = result.image;
    } else if (result?.data?.images?.[0]) {
        // Old format (e.g., ideogram)
        upscaledImage = result.data.images[0];
    }

    if (!upscaledImage || !upscaledImage.url) throw new Error("Upscaling service did not return a valid image URL.");

    const imageResponse = await fetch(upscaledImage.url);
    if (!imageResponse.ok) throw new Error(`Failed to download generated image from ${upscaledImage.url}`);
    const imageBuffer = await imageResponse.arrayBuffer();

    const { data: parentJob } = await supabase.from('mira_agent_tiled_upscale_jobs').select('user_id').eq('id', parent_job_id).single();
    if (!parentJob) throw new Error(`Parent job ${parent_job_id} not found.`);

    const finalFilePath = `${parentJob.user_id}/${parent_job_id}/generated_tile_${tile_id}.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(finalFilePath, imageBuffer, { contentType: 'image/png', upsert: true });
    
    await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ 
        generated_tile_bucket: GENERATED_IMAGES_BUCKET,
        generated_tile_path: finalFilePath,
        status: 'complete' 
      })
      .eq('id', tile_id);

    console.log(`${logPrefix} Job complete.`);
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ status: 'generation_failed', error_message: `Generation failed: ${error.message}` })
      .eq('id', tile_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});