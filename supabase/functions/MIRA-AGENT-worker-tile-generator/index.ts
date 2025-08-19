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
  console.log(`${logPrefix} Invoked.`);

  try {
    if (!FAL_KEY) {
      throw new Error("Server configuration error: Missing FAL_KEY secret.");
    }
    fal.config({ credentials: FAL_KEY });

    const { data: tile, error: fetchError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .select('source_tile_url, generated_prompt, parent_job_id')
      .eq('id', tile_id)
      .single();

    if (fetchError) throw fetchError;
    if (!tile) throw new Error(`Tile with ID ${tile_id} not found.`);
    if (!tile.source_tile_url || !tile.generated_prompt) {
      throw new Error("Tile is missing source_tile_url or generated_prompt.");
    }
    
    console.log(`${logPrefix} Fetched tile data. Prompt: "${tile.generated_prompt.substring(0, 50)}..."`);

    const falInput = {
      image_url: tile.source_tile_url,
      prompt: tile.generated_prompt,
      resemblance: 75,
      detail: 60,
      expand_prompt: false,
    };

    console.log(`${logPrefix} Calling fal-ai/ideogram/upscale with payload...`);
    const result: any = await fal.subscribe("fal-ai/ideogram/upscale", {
      input: falInput,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs) {
          update.logs.forEach((log) => console.log(`${logPrefix} [Fal-Log] ${log.message}`));
        }
      },
    });

    const upscaledImage = result?.data?.images?.[0];
    if (!upscaledImage || !upscaledImage.url) {
      throw new Error("Upscaling service did not return a valid image URL.");
    }
    console.log(`${logPrefix} Upscaling successful. New URL: ${upscaledImage.url}`);

    const imageResponse = await fetch(upscaledImage.url);
    if (!imageResponse.ok) throw new Error(`Failed to download generated image from ${upscaledImage.url}`);
    const imageBuffer = await imageResponse.arrayBuffer();

    const { data: parentJob, error: parentFetchError } = await supabase
        .from('mira_agent_tiled_upscale_jobs')
        .select('user_id')
        .eq('id', tile.parent_job_id)
        .single();
    if (parentFetchError) throw parentFetchError;

    const filePath = `${parentJob.user_id}/${tile.parent_job_id}/generated_tile_${tile_id}.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    console.log(`${logPrefix} Uploaded final image to storage: ${publicUrl}`);

    await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ generated_tile_url: publicUrl, status: 'complete' })
      .eq('id', tile_id);

    console.log(`${logPrefix} Job complete.`);
    return new Response(JSON.stringify({ success: true, generated_tile_url: publicUrl }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ status: 'generation_failed', error_message: `Generation failed: ${error.message}` })
      .eq('id', tile_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});