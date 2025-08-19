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
      
      await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'analyzing' }).in('id', tileIds);

      const analysisPromises = tileIds.map(tile_id => 
        supabase.functions.invoke('MIRA-AGENT-worker-tile-analyzer', { body: { tile_id } })
      );
      await Promise.allSettled(analysisPromises);
      console.log(`${logPrefix} Dispatched ${tileIds.length} analysis workers.`);
    } else {
      console.log(`${logPrefix} No tiles pending analysis.`);
    }

    // --- Generation Step ---
    console.log(`${logPrefix} Checking for tiles pending generation...`);
    const { data: pendingGenerationTiles, error: fetchGenerationError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .select('id')
      .eq('status', 'pending_generation')
      .limit(BATCH_SIZE);

    if (fetchGenerationError) throw fetchGenerationError;

    if (pendingGenerationTiles && pendingGenerationTiles.length > 0) {
      console.log(`${logPrefix} Found ${pendingGenerationTiles.length} tiles to generate. Claiming and dispatching...`);
      const tileIds = pendingGenerationTiles.map(t => t.id);

      await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'generating' }).in('id', tileIds);

      const generationPromises = tileIds.map(tile_id =>
        supabase.functions.invoke('MIRA-AGENT-worker-tile-generator', { body: { tile_id } })
      );
      await Promise.allSettled(generationPromises);
      console.log(`${logPrefix} Dispatched ${tileIds.length} generation workers.`);
    } else {
      console.log(`${logPrefix} No tiles pending generation.`);
    }

    // --- Compositing Step ---
    console.log(`${logPrefix} Checking for parent jobs ready for compositing...`);
    const { data: generatingJobs, error: fetchGeneratingError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .select('id, (select count(id) from mira_agent_tiled_upscale_tiles where parent_job_id = mira_agent_tiled_upscale_jobs.id) as total_tiles, (select count(id) from mira_agent_tiled_upscale_tiles where parent_job_id = mira_agent_tiled_upscale_jobs.id and status = \'complete\') as completed_tiles')
      .eq('status', 'generating');

    if (fetchGeneratingError) throw fetchGeneratingError;

    if (generatingJobs && generatingJobs.length > 0) {
        for (const job of generatingJobs) {
            if (job.total_tiles > 0 && job.total_tiles === job.completed_tiles) {
                console.log(`${logPrefix} Job ${job.id} is ready for compositing. Claiming and dispatching...`);
                await supabase.from('mira_agent_tiled_upscale_jobs').update({ status: 'compositing' }).eq('id', job.id);
                supabase.functions.invoke('MIRA-AGENT-compositor-tiled-upscale', { body: { parent_job_id: job.id } }).catch(console.error);
            }
        }
    } else {
        console.log(`${logPrefix} No jobs in 'generating' state found.`);
    }

    return new Response(JSON.stringify({ success: true, message: "Watchdog check complete." }), { headers: corsHeaders });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});