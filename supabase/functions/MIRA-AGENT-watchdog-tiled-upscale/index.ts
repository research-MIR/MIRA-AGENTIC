import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BATCH_SIZE = 10;
const STALLED_ANALYSIS_THRESHOLD_SECONDS = 300; // 5 minutes
const STALLED_GENERATION_THRESHOLD_SECONDS = 900; // 15 minutes
const FAILED_TILE_CLEANUP_THRESHOLD_MINUTES = 60; // 1 hour
const STALLED_ACTIVE_JOB_THRESHOLD_MINUTES = 15; // New: 15 minutes for a whole job to be stuck

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TiledUpscaleWatchdog]`;

  try {
    const { data: lockAcquired, error: lockError } = await supabase.rpc('try_acquire_tiled_upscale_watchdog_lock');
    if (lockError) throw lockError;
    if (!lockAcquired) {
      console.log(`${logPrefix} Advisory lock is held by another process. Exiting gracefully.`);
      return new Response(JSON.stringify({ message: "Lock held, skipping execution." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }
    console.log(`${logPrefix} Advisory lock acquired. Proceeding with checks.`);

    // --- Stalled Active Job Recovery (Catch-all) ---
    const stalledActiveThreshold = new Date(Date.now() - STALLED_ACTIVE_JOB_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const { data: stalledActiveJobs, error: stalledActiveError } = await supabase
        .from('mira_agent_tiled_upscale_jobs')
        .select('id')
        .in('status', ['tiling', 'compositing', 'queued_for_generation', 'generating'])
        .lt('updated_at', stalledActiveThreshold);

    if (stalledActiveError) {
        console.error(`${logPrefix} Error fetching stalled active jobs:`, stalledActiveError);
        throw stalledActiveError;
    }

    if (stalledActiveJobs && stalledActiveJobs.length > 0) {
        const jobIdsToFail = stalledActiveJobs.map(j => j.id);
        console.log(`${logPrefix} Found ${jobIdsToFail.length} active jobs that have stalled for over ${STALLED_ACTIVE_JOB_THRESHOLD_MINUTES} minutes. Marking them as failed.`);
        
        const { error: failStalledError } = await supabase
            .from('mira_agent_tiled_upscale_jobs')
            .update({ status: 'failed', error_message: `Job failed due to stalling for over ${STALLED_ACTIVE_JOB_THRESHOLD_MINUTES} minutes.` })
            .in('id', jobIdsToFail);

        if (failStalledError) {
            console.error(`${logPrefix} Error marking stalled active jobs as failed:`, failStalledError);
            throw failStalledError;
        }
    }

    // --- Cleanup for Permanently Failed Jobs ---
    const failedCleanupThreshold = new Date(Date.now() - FAILED_TILE_CLEANUP_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const { data: failedTiles, error: fetchFailedError } = await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .select('parent_job_id')
        .in('status', ['generation_failed', 'analysis_failed'])
        .lt('updated_at', failedCleanupThreshold);
    
    if (fetchFailedError) {
        console.error(`${logPrefix} Error fetching failed tiles for cleanup:`, fetchFailedError);
        throw fetchFailedError;
    }

    if (failedTiles && failedTiles.length > 0) {
        const parentJobIdsToFail = [...new Set(failedTiles.map(t => t.parent_job_id))];
        console.log(`${logPrefix} Found ${parentJobIdsToFail.length} parent jobs with permanently failed tiles. Marking them as failed.`);
        const { error: failParentError } = await supabase
            .from('mira_agent_tiled_upscale_jobs')
            .update({ status: 'failed', error_message: 'Job failed because one or more tiles could not be processed.' })
            .in('id', parentJobIdsToFail)
            .not('status', 'in', '("failed","complete")');
        if (failParentError) {
            console.error(`${logPrefix} Error marking parent jobs as failed:`, failParentError);
            throw failParentError;
        }
    }

    // --- Concurrency Logic (Runs AFTER cleanup) ---
    const { data: config, error: configError } = await supabase.from('mira-agent-config').select('value').eq('key', 'TILED_UPSCALE_CONCURRENCY_LIMIT').single();
    if (configError) throw new Error(`Failed to fetch concurrency limit: ${configError.message}`);
    const concurrencyLimit = config?.value?.limit || 1;

    const { count: activeJobsCount, error: countError } = await supabase
        .from('mira_agent_tiled_upscale_jobs')
        .select('*', { count: 'exact', head: true })
        .in('status', ['tiling', 'compositing', 'queued_for_generation']);
    if (countError) throw countError;

    const availableSlots = concurrencyLimit - (activeJobsCount || 0);
    console.log(`${logPrefix} Concurrency check: Limit=${concurrencyLimit}, Active=${activeJobsCount}, Available=${availableSlots}`);

    if (availableSlots > 0) {
        const { data: jobsToStart, error: claimError } = await supabase
            .from('mira_agent_tiled_upscale_jobs')
            .select('id')
            .eq('status', 'pending')
            .order('created_at', { ascending: true })
            .limit(availableSlots);
        
        if (claimError) throw claimError;

        if (jobsToStart && jobsToStart.length > 0) {
            const jobIdsToClaim = jobsToStart.map(j => j.id);
            console.log(`${logPrefix} Claiming ${jobIdsToClaim.length} pending jobs...`);
            
            const { error: updateError } = await supabase
                .from('mira_agent_tiled_upscale_jobs')
                .update({ status: 'tiling' })
                .in('id', jobIdsToClaim);
            
            if (updateError) throw updateError;

            const workerPromises = jobIdsToClaim.map(jobId => 
                supabase.functions.invoke('MIRA-AGENT-worker-tiling-and-analysis', { body: { parent_job_id: jobId } })
            );
            await Promise.allSettled(workerPromises);
            console.log(`${logPrefix} Invoked tiling workers for ${jobIdsToClaim.length} jobs.`);
        } else {
            console.log(`${logPrefix} No pending jobs to start.`);
        }
    }

    // Stalled Job Recovery for ANALYSIS
    const stalledAnalysisThreshold = new Date(Date.now() - STALLED_ANALYSIS_THRESHOLD_SECONDS * 1000).toISOString();
    const { error: updateAnalysisError } = await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({ status: 'analysis_failed', error_message: 'Reset by watchdog due to stall in analysis.' })
        .eq('status', 'analyzing')
        .lt('updated_at', stalledAnalysisThreshold);
    if (updateAnalysisError) console.error(`${logPrefix} Error updating stalled analysis jobs:`, updateAnalysisError);

    // Stalled Job Recovery for GENERATION
    const stalledGenerationThreshold = new Date(Date.now() - STALLED_GENERATION_THRESHOLD_SECONDS * 1000).toISOString();
    const { error: updateGenerationError } = await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({ status: 'generation_failed', error_message: 'Reset by watchdog due to stall in generation.' })
        .eq('status', 'generating')
        .lt('updated_at', stalledGenerationThreshold);
    if (updateGenerationError) console.error(`${logPrefix} Error updating stalled generation jobs:`, updateGenerationError);

    // Dispatch Pending Analysis
    const { data: pendingAnalysisTiles, error: fetchAnalysisError } = await supabase.from('mira_agent_tiled_upscale_tiles').select('id').eq('status', 'pending_analysis').limit(BATCH_SIZE);
    if (fetchAnalysisError) throw fetchAnalysisError;
    if (pendingAnalysisTiles && pendingAnalysisTiles.length > 0) {
      const analysisPromises = pendingAnalysisTiles.map(t => supabase.functions.invoke('MIRA-AGENT-worker-tile-analyzer', { body: { tile_id: t.id } }));
      await Promise.allSettled(analysisPromises);
    }

    // Dispatch Pending Generation
    const { data: pendingGenerationTiles, error: fetchGenerationError } = await supabase.from('mira_agent_tiled_upscale_tiles').select('id').eq('status', 'pending_generation').not('source_tile_bucket', 'is', null).not('source_tile_path', 'is', null).limit(BATCH_SIZE);
    if (fetchGenerationError) throw fetchGenerationError;
    if (pendingGenerationTiles && pendingGenerationTiles.length > 0) {
      const generationPromises = pendingGenerationTiles.map(t => supabase.functions.invoke('MIRA-AGENT-worker-tile-generator', { body: { tile_id: t.id } }));
      await Promise.allSettled(generationPromises);
    }

    // Trigger Compositor
    const { data: generatingJobs, error: fetchGeneratingError } = await supabase.from('mira_agent_tiled_upscale_jobs').select('id, total_tiles, comp_next_index, compositor_worker_id, comp_lease_expires_at, status').in('status', ['generating', 'queued_for_generation', 'compositing']);
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
      const compositorInvocations = [];
      for (const job of generatingJobs) {
        const total = job.total_tiles || 0;
        const completed = jobCounts[job.id]?.complete || 0;
        const isReadyForCompositing = total > 0 && total === completed;
        if (isReadyForCompositing && (job.status === 'generating' || job.status === 'queued_for_generation')) {
            const { data: claimed, error: rpcError } = await supabase.rpc('try_set_job_to_compositing', { p_job_id: job.id });
            if (rpcError) { console.error(`${logPrefix} RPC try_set_job_to_compositing failed for job ${job.id}:`, rpcError.message); continue; }
            if (claimed) {
                console.log(`${logPrefix} Successfully claimed job ${job.id} via RPC. Invoking compositor.`);
                compositorInvocations.push(supabase.functions.invoke('MIRA-AGENT-compositor-tiled-upscale', { body: { parent_job_id: job.id } }));
            } else {
                console.log(`${logPrefix} Job ${job.id} was already claimed by another instance. Skipping invocation.`);
            }
        } else if (job.status === 'compositing') {
            const isStalled = job.compositor_worker_id && new Date(job.comp_lease_expires_at) < new Date();
            if (isStalled) {
                console.warn(`${logPrefix} Stalled compositor job ${job.id} detected. Re-invoking compositor.`);
                compositorInvocations.push(supabase.functions.invoke('MIRA-AGENT-compositor-tiled-upscale', { body: { parent_job_id: job.id } }));
            }
        }
      }
      if (compositorInvocations.length > 0) {
        await Promise.allSettled(compositorInvocations);
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