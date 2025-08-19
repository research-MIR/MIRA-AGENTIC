import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BATCH_SIZE = 10; // Number of tiles to process per watchdog run

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TiledUpscaleWatchdog]`;

  try {
    // --- Analysis Step ---
    console.log(`${logPrefix} Checking for tiles pending analysis...`);
    const { data: pendingAnalysisTiles, error: fetchAnalysisError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .select('id')
      .eq('status', 'pending_analysis')
      .limit(BATCH_SIZE);

    if (fetchAnalysisError) throw fetchAnalysisError;

    if (pendingAnalysisTiles && pendingAnalysisTiles.length > 0) {
      console.log(`${logPrefix} Found ${pendingAnalysisTiles.length} tiles to analyze. Claiming and dispatching...`);
      const tileIds = pendingAnalysisTiles.map(t => t.id);
      
      // Atomically claim the jobs
      await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({ status: 'analyzing' })
        .in('id', tileIds);

      // Asynchronously invoke workers
      const analysisPromises = tileIds.map(tile_id => 
        supabase.functions.invoke('MIRA-AGENT-worker-tile-analyzer', { body: { tile_id } })
      );
      await Promise.allSettled(analysisPromises);
      console.log(`${logPrefix} Dispatched ${tileIds.length} analysis workers.`);
    } else {
      console.log(`${logPrefix} No tiles pending analysis.`);
    }

    // --- TODO: Generation Step ---
    // In the future, we will add logic here to find tiles with status 'pending_generation'
    // and invoke the 'MIRA-AGENT-worker-tile-generator'.

    // --- TODO: Compositing Step ---
    // In the future, we will add logic here to find parent jobs where all tiles are 'complete'
    // and invoke the 'MIRA-AGENT-compositor-tiled-upscale'.

    return new Response(JSON.stringify({ success: true, message: "Watchdog check complete." }), { headers: corsHeaders });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});