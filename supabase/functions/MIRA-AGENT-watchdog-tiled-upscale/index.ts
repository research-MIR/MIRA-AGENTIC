import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BATCH_SIZE = 10;
const STALLED_THRESHOLD_SECONDS = 180;
const MAX_RETRIES = 3;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TiledUpscaleWatchdog]`;

  try {
    // --- Stalled Job Recovery ---
    const stalledThreshold = new Date(Date.now() - STALLED_THRESHOLD_SECONDS * 1000).toISOString();
    
    await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ status: 'pending_analysis', error_message: 'Reset by watchdog due to stall.' })
      .eq('status','analyzing')
      .lt('updated_at', stalledThreshold);

    await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ status: 'pending_generation', error_message: 'Reset by watchdog due to stall.' })
      .eq('status','generating')
      .lt('updated_at', stalledThreshold);

    // --- Failed Job Retry ---
    const { data: failedTiles, error: fetchFailedError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .select('id, status, analysis_retry_count, generation_retry_count')
      .in('status', ['analysis_failed', 'generation_failed'])
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`);
    
    if (fetchFailedError) throw fetchFailedError;

    if (failedTiles && failedTiles.length > 0) {
        console.log(`${logPrefix} Found ${failedTiles.length} failed tiles eligible for retry. Processing individually...`);
        for (const tile of failedTiles) {
            const isAnalysis = tile.status === 'analysis_failed';
            const currentRetries = (isAnalysis ? tile.analysis_retry_count : tile.generation_retry_count) || 0;
            
            if (currentRetries >= MAX_RETRIES) continue;

            const newRetryCount = currentRetries + 1;
            const backoffSeconds = 300 * Math.pow(2, newRetryCount - 1); // 5m, 10m, 20m
            const nextAttempt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

            await supabase.from('mira_agent_tiled_upscale_tiles').update({
                status: isAnalysis ? 'pending_analysis' : 'pending_generation',
                error_message: `Retrying after previous failure (Attempt ${newRetryCount}).`,
                analysis_retry_count: isAnalysis ? newRetryCount : tile.analysis_retry_count,
                generation_retry_count: !isAnalysis ? newRetryCount : tile.generation_retry_count,
                next_attempt_at: nextAttempt
            }).eq('id', tile.id);
        }
    }

    // --- Dispatch Pending Analysis ---
    const { data: pendingAnalysisTiles, error: fetchAnalysisError } = await supabase.from('mira_agent_tiled_upscale_tiles').select('id').eq('status', 'pending_analysis').limit(BATCH_SIZE);
    if (fetchAnalysisError) throw fetchAnalysisError;
    if (pendingAnalysisTiles && pendingAnalysisTiles.length > 0) {
      const tileIds = pendingAnalysisTiles.map(t => t.id);
      const analysisPromises = tileIds.map(tile_id => supabase.functions.invoke('MIRA-AGENT-worker-tile-analyzer', { body: { tile_id } }));
      await Promise.allSettled(analysisPromises);
      console.log(`${logPrefix} Dispatched ${tileIds.length} analysis workers.`);
    }

    // --- Dispatch Pending Generation ---
    const { data: pendingGenerationTiles, error: fetchGenerationError } = await supabase.from('mira_agent_tiled_upscale_tiles').select('id').eq('status', 'pending_generation').limit(BATCH_SIZE);
    if (fetchGenerationError) throw fetchGenerationError;
    if (pendingGenerationTiles && pendingGenerationTiles.length > 0) {
      const tileIds = pendingGenerationTiles.map(t => t.id);
      const generationPromises = tileIds.map(tile_id => supabase.functions.invoke('MIRA-AGENT-worker-tile-generator', { body: { tile_id } }));
      await Promise.allSettled(generationPromises);
      console.log(`${logPrefix} Dispatched ${tileIds.length} generation workers.`);
    }

    // --- Trigger Compositor ---
    const { data: generatingJobs, error: fetchGeneratingError } = await supabase.from('mira_agent_tiled_upscale_jobs').select('id, total_tiles').eq('status', 'generating');
    if (fetchGeneratingError) throw fetchGeneratingError;
    if (generatingJobs && generatingJobs.length > 0) {
      const jobIds = generatingJobs.map(j => j.id);
      const { data: allTiles, error: fetchTilesError } = await supabase.from('mira_agent_tiled_upscale_tiles').select('parent_job_id, status').in('parent_job_id', jobIds);
      if (fetchTilesError) throw fetchTilesError;
      
      const jobCounts = jobIds.reduce((acc, id) => ({ ...acc, [id]: { total: 0, complete: 0 } }), {} as Record<string, { total: number, complete: number }>);
      allTiles.forEach(tile => {
        if (jobCounts[tile.parent_job_id!]) {
          jobCounts[tile.parent_job_id!].total++;
          if (tile.status === 'complete') jobCounts[tile.parent_job_id!].complete++;
        }
      });

      const jobsReadyForCompositing = Object.entries(jobCounts).filter(([_, counts]) => counts.total > 0 && counts.total === counts.complete).map(([jobId]) => jobId);
      if (jobsReadyForCompositing.length > 0) {
        await supabase.from('mira_agent_tiled_upscale_jobs').update({ status: 'compositing' }).in('id', jobsReadyForCompositing);
        const compositorPromises = jobsReadyForCompositing.map(jobId => supabase.functions.invoke('MIRA-AGENT-compositor-tiled-upscale', { body: { parent_job_id: jobId } }));
        await Promise.allSettled(compositorPromises);
        console.log(`${logPrefix} Dispatched ${jobsReadyForCompositing.length} compositor jobs.`);
      }
    }

    return new Response(JSON.stringify({ success: true, message: "Watchdog check complete." }), { headers: corsHeaders });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});