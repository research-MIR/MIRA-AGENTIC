import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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
      .select('parent_job_id, source_tile_bucket, source_tile_path')
      .single();

    if (claimError) throw new Error(`Claiming tile failed: ${claimError.message}`);
    if (!claimedTile) {
      console.log(`${logPrefix} Tile already claimed or not in 'pending_generation' state. Exiting.`);
      return new Response(JSON.stringify({ success: true, message: "Tile not eligible for generation." }), { headers: corsHeaders });
    }

    const { parent_job_id, source_tile_bucket, source_tile_path } = claimedTile;

    const { data: parentJob, error: fetchParentError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .select('user_id, metadata')
      .eq('id', parent_job_id)
      .single();
    
    if (fetchParentError) throw new Error(`Failed to fetch parent job: ${fetchParentError.message}`);

    const { data: { publicUrl } } = supabase.storage.from(source_tile_bucket).getPublicUrl(source_tile_path);

    const enhancor_mode = parentJob.metadata?.upscaler_engine || 'enhancor_detailed';

    const { error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-enhancor-ai', {
      body: {
        user_id: parentJob.user_id,
        source_image_urls: [publicUrl],
        enhancor_mode: enhancor_mode,
        tile_id: tile_id,
      }
    });

    if (proxyError) throw new Error(`Failed to invoke Enhancor proxy: ${proxyError.message}`);

    console.log(`${logPrefix} Successfully dispatched tile to EnhancorAI proxy.`);
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'generation_failed', error_message: `Generation worker failed: ${error.message}` }).eq('id', tile_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});