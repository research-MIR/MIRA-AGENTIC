import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

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

    const { data: parentJob, error: parentFetchError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .select('user_id, metadata')
      .eq('id', parent_job_id)
      .single();
    
    if (parentFetchError) throw new Error(`Could not fetch parent job ${parent_job_id}: ${parentFetchError.message}`);
    if (!parentJob) throw new Error(`Parent job ${parent_job_id} not found.`);

    const upscaler_engine = parentJob.metadata?.upscaler_engine || 'creative_upscaler';
    console.log(`${logPrefix} Routing to upscaler engine: '${upscaler_engine}'.`);

    if (upscaler_engine === 'comfyui_fal_upscaler') {
        const { data: imageBlob, error: downloadError } = await supabase.storage.from(source_tile_bucket).download(source_tile_path);
        if (downloadError) throw downloadError;
        const image_base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(imageBlob);
            reader.onload = () => resolve((reader.result as string).split(',')[1]);
            reader.onerror = (error) => reject(error);
        });

        const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-fal-comfyui', {
            body: {
                method: 'submit',
                input: {
                    ksampler_denoise: 0.4,
                    imagescaleby_scale_by: 0.5,
                    controlnetapplyadvanced_strength: 0.85,
                    controlnetapplyadvanced_end_percent: 0.85,
                },
                image_base64,
                mime_type: imageBlob.type,
                user_id: parentJob.user_id
            }
        });
        if (proxyError) throw proxyError;

        await supabase.from('mira_agent_tiled_upscale_tiles').update({
            status: 'generating_comfyui',
            metadata: { fal_comfyui_job_id: proxyData.jobId }
        }).eq('id', tile_id);
        
        console.log(`${logPrefix} Delegated to ComfyUI job ${proxyData.jobId}. Watchdog will monitor for completion.`);

    } else { // Default to 'creative_upscaler'
        const { data: signedUrlData, error: signedUrlError } = await supabase.storage
          .from(source_tile_bucket)
          .createSignedUrl(source_tile_path, 300);
        if (signedUrlError) throw signedUrlError;

        fal.config({ credentials: FAL_KEY! });
        const falInput = {
            image_url: signedUrlData.signedUrl,
            prompt: generated_prompt,
            // ... other creative upscaler params
        };
        const result: any = await fal.subscribe("fal-ai/creative-upscaler", { input: falInput, logs: true });
        const upscaledImage = result?.data?.image;
        if (!upscaledImage || !upscaledImage.url) throw new Error("Creative upscaler did not return a valid image URL.");

        const imageResponse = await fetch(upscaledImage.url);
        if (!imageResponse.ok) throw new Error(`Failed to download generated image from ${upscaledImage.url}`);
        const imageBuffer = await imageResponse.arrayBuffer();
        const finalFilePath = `${parentJob.user_id}/${parent_job_id}/generated_tile_${tile_id}.png`;

        await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(finalFilePath, imageBuffer, { contentType: 'image/png', upsert: true });
        
        await supabase.from('mira_agent_tiled_upscale_tiles').update({ 
            generated_tile_bucket: GENERATED_IMAGES_BUCKET,
            generated_tile_path: finalFilePath,
            status: 'complete' 
        }).eq('id', tile_id);
    }

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