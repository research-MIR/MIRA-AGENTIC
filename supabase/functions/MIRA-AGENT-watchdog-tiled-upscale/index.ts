import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BATCH_SIZE = 10; // Number of tiles to process per watchdog run
const STALLED_ANALYZING_THRESHOLD_SECONDS = 120; // 2 minutes
const STALLED_GENERATING_THRESHOLD_SECONDS = 180; // 3 minutes

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TiledUpscaleWatchdog]`;

  try {
    // --- Stalled Analysis Recovery Step ---
    console.log(`${logPrefix} Checking for tiles stalled in 'analyzing' state...`);
    const analyzingThreshold = new Date(Date.now() - STALLED_ANALYZING_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledAnalyzingTiles, error: fetchStalledAnalysisError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .select('id')
      .eq('status', 'analyzing')
      .lt('updated_at', analyzingThreshold);

    if (fetchStalledAnalysisError) throw fetchStalledAnalysisError;

    if (stalledAnalyzingTiles && stalledAnalyzingTiles.length > 0) {
      console.log(`${logPrefix} Found ${stalledAnalyzingTiles.length} stalled analysis tiles. Resetting to 'pending_analysis' for retry.`);
      const stalledTileIds = stalledAnalyzingTiles.map(t => t.id);
      await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({ status: 'pending_analysis', error_message: 'Reset by watchdog due to analysis stall.', updated_at: new Date().toISOString() })
        .in('id', stalledTileIds);
    } else {
      console.log(`${logPrefix} No stalled analysis tiles found.`);
    }

    // --- Stalled Generation Recovery Step ---
    console.log(`${logPrefix} Checking for tiles stalled in 'generating' state...`);
    const generatingThreshold = new Date(Date.now() - STALLED_GENERATING_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledGeneratingTiles, error: fetchStalledGeneratingError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .select('id')
      .eq('status', 'generating')
      .lt('updated_at', generatingThreshold);

    if (fetchStalledGeneratingError) throw fetchStalledGeneratingError;

    if (stalledGeneratingTiles && stalledGeneratingTiles.length > 0) {
      console.log(`${logPrefix} Found ${stalledGeneratingTiles.length} stalled generation tiles. Resetting to 'pending_generation' for retry.`);
      const stalledTileIds = stalledGeneratingTiles.map(t => t.id);
      await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({ status: 'pending_generation', error_message: 'Reset by watchdog due to generation stall.', updated_at: new Date().toISOString() })
        .in('id', stalledTileIds);
    } else {
      console.log(`${logPrefix} No stalled generating tiles found.`);
    }

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
      
      await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'analyzing', updated_at: new Date().toISOString() }).in('id', tileIds);

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

      await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'generating', updated_at: new Date().toISOString() }).in('id', tileIds);

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
      .select('id')
      .eq('status', 'generating');

    if (fetchGeneratingError) throw fetchGeneratingError;

    if (generatingJobs && generatingJobs.length > 0) {
        const jobIds = generatingJobs.map(j => j.id);

        const { data: allTiles, error: fetchTilesError } = await supabase
            .from('mira_agent_tiled_upscale_tiles')
            .select('parent_job_id, status')
            .in('parent_job_id', jobIds);
        
        if (fetchTilesError) throw fetchTilesError;

        const jobCounts = jobIds.reduce((acc, id) => {
            acc[id] = { total_tiles: 0, completed_tiles: 0 };
            return acc;
        }, {} as Record<string, { total_tiles: number, completed_tiles: number }>);

        for (const tile of allTiles) {
            if (jobCounts[tile.parent_job_id!]) {
                jobCounts[tile.parent_job_id!].total_tiles++;
                if (tile.status === 'complete') {
                    jobCounts[tile.parent_job_id!].completed_tiles++;
                }
            }
        }

        const jobsReadyForCompositing = Object.entries(jobCounts)
            .filter(([_, counts]) => counts.total_tiles > 0 && counts.total_tiles === counts.completed_tiles)
            .map(([jobId, _]) => jobId);

        if (jobsReadyForCompositing.length > 0) {
            console.log(`${logPrefix} Found ${jobsReadyForCompositing.length} job(s) ready for compositing. Claiming and dispatching...`);
            await supabase.from('mira_agent_tiled_upscale_jobs').update({ status: 'compositing' }).in('id', jobsReadyForCompositing);
            
            const compositorPromises = jobsReadyForCompositing.map(jobId =>
                supabase.functions.invoke('MIRA-AGENT-compositor-tiled-upscale', { body: { parent_job_id: jobId } })
            );
            await Promise.allSettled(compositorPromises);
        } else {
            console.log(`${logPrefix} No jobs in 'generating' state are ready for compositing yet.`);
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