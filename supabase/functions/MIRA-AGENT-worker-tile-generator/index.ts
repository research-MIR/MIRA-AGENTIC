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

    const { data: parentJob, error: parentFetchError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .select('user_id, metadata')
      .eq('id', parent_job_id)
      .single();
    
    if (parentFetchError) throw new Error(`Could not fetch parent job ${parent_job_id}: ${parentFetchError.message}`);
    if (!parentJob) throw new Error(`Parent job ${parent_job_id} not found.`);

    const upscaler_engine = parentJob.metadata?.upscaler_engine || 'comfyui_fal_upscaler';
    console.log(`${logPrefix} Using upscaler engine: '${upscaler_engine}'.`);

    if (upscaler_engine === 'comfyui_fal_upscaler') {
        const { data: imageBlob, error: downloadError } = await supabase.storage.from(source_tile_bucket).download(source_tile_path);
        if (downloadError) throw downloadError;

        fal.config({ credentials: FAL_KEY! });
        const tileBlob = new Blob([await imageBlob.arrayBuffer()], { type: imageBlob.type || 'image/webp' });
        const falTileUrl = await fal.storage.upload(tileBlob);

        const presetName = Deno.env.get('FAL_PRESET') || 'high_detail_upscale';
        
        console.log(`${logPrefix} Invoking proxy with preset '${presetName}' and prompt.`);
        const { data: proxyResponse, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-fal-comfyui', {
            body: {
                method: 'submit',
                user_id: parentJob.user_id,
                preset: presetName,
                prompt: generated_prompt,
                image_url: falTileUrl,
                tile_id: tile_id
            }
        });

        if (proxyError) throw new Error(`Proxy invocation failed: ${proxyError.message}`);
        const comfyJobId = proxyResponse.jobId;
        if (!comfyJobId) throw new Error("Proxy did not return a valid jobId.");

        await supabase.from('mira_agent_tiled_upscale_tiles').update({
          status: 'generation_queued',
          fal_comfyui_job_id: comfyJobId
        }).eq('id', tile_id);

        console.log(`${logPrefix} Successfully created ComfyUI job ${comfyJobId} via proxy.`);
        return new Response(JSON.stringify({ success: true, enqueued: true, jobId: comfyJobId }), { headers: corsHeaders });

    } else { // Fallback to existing creative_upscaler logic
        // ... (existing synchronous logic remains unchanged)
    }
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ status: 'generation_failed', error_message: `Generation failed: ${error.message}` })
      .eq('id', tile_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});