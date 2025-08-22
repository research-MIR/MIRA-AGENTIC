import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-agent-upscale-tiles';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[FalComfyUI-Webhook]`;

  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    const tileId = url.searchParams.get('tile_id');

    if (!jobId || !tileId) {
      throw new Error("Webhook received without job_id or tile_id in the query parameters.");
    }
    console.log(`${logPrefix} Received webhook for job ${jobId}, tile ${tileId}.`);

    // NOTE: For production, signature verification should be implemented here
    // using the logic from the Fal.ai documentation to ensure the request is authentic.

    const payload = await req.json();
    const { status, payload: resultPayload, error: falError } = payload;

    if (status === 'OK' && resultPayload) {
      console.log(`${logPrefix} Job ${jobId} completed successfully.`);
      const imageUrl = resultPayload?.outputs?.['283']?.images?.[0]?.url;
      if (!imageUrl) {
        throw new Error("Fal.ai webhook payload is missing the expected image URL in outputs.283.images[0].url");
      }

      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) throw new Error(`Failed to download final image from Fal.ai: ${imageResponse.statusText}`);
      const imageBuffer = await imageResponse.arrayBuffer();

      const filePath = `${jobId}/final.png`;
      await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
      
      await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({
            status: 'complete',
            generated_tile_bucket: GENERATED_IMAGES_BUCKET,
            generated_tile_path: filePath,
            generation_result: resultPayload,
        })
        .eq('id', tileId);
      
      await supabase
        .from('fal_comfyui_jobs')
        .update({ status: 'complete', final_result: resultPayload })
        .eq('id', jobId);

      console.log(`${logPrefix} Tile ${tileId} successfully finalized and stored at ${filePath}.`);

    } else {
      const errorMessage = `Fal.ai reported failure. Status: ${status}. Error: ${JSON.stringify(falError || payload)}`;
      console.error(`${logPrefix} Job ${jobId} failed: ${errorMessage}`);
      
      await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({ status: 'generation_failed', error_message: errorMessage })
        .eq('id', tileId);
      
      await supabase
        .from('fal_comfyui_jobs')
        .update({ status: 'failed', error_message: errorMessage })
        .eq('id', jobId);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});