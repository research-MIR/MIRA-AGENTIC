import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';

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
    const { data: lockAcquired, error: lockError } = await supabase.rpc('try_acquire_watchdog_lock');
    if (lockError) throw lockError;
    if (!lockAcquired) {
      console.log(`${logPrefix} Advisory lock is held by another process. Exiting gracefully.`);
      return new Response(JSON.stringify({ message: "Lock held, skipping execution." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }
    console.log(`${logPrefix} Advisory lock acquired. Proceeding with checks.`);

    // Stalled Job Recovery
    const stalledThreshold = new Date(Date.now() - STALLED_THRESHOLD_SECONDS * 1000).toISOString();
    await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'pending_analysis', error_message: 'Reset by watchdog due to stall.' }).eq('status','analyzing').lt('updated_at', stalledThreshold);
    await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'pending_generation', error_message: 'Reset by watchdog due to stall.' }).eq('status','generating').lt('updated_at', stalledThreshold);

    // Failed Job Retry
    const { data: failedTiles, error: fetchFailedError } = await supabase.from('mira_agent_tiled_upscale_tiles').select('id, status, analysis_retry_count, generation_retry_count').in('status', ['analysis_failed', 'generation_failed']).or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`);
    if (fetchFailedError) throw fetchFailedError;
    if (failedTiles && failedTiles.length > 0) {
        for (const tile of failedTiles) {
            const isAnalysis = tile.status === 'analysis_failed';
            const currentRetries = (isAnalysis ? tile.analysis_retry_count : tile.generation_retry_count) || 0;
            if (currentRetries >= MAX_RETRIES) continue;
            const newRetryCount = currentRetries + 1;
            const backoffSeconds = 300 * Math.pow(2, newRetryCount - 1);
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

    // Dispatch Pending Analysis
    const { data: pendingAnalysisTiles, error: fetchAnalysisError } = await supabase.from('mira_agent_tiled_upscale_tiles').select('id').eq('status', 'pending_analysis').not('source_tile_bucket', 'is', null).not('source_tile_path', 'is', null).limit(BATCH_SIZE);
    if (fetchAnalysisError) throw fetchAnalysisError;
    if (pendingAnalysisTiles && pendingAnalysisTiles.length > 0) {
      const analysisPromises = pendingAnalysisTiles.map(t => supabase.functions.invoke('MIRA-AGENT-worker-tile-analyzer', { body: { tile_id: t.id } }));
      await Promise.allSettled(analysisPromises);
    }

    // Dispatch Pending Generation (for creative_upscaler)
    const { data: pendingGenerationTiles, error: fetchGenerationError } = await supabase.from('mira_agent_tiled_upscale_tiles').select('id').eq('status', 'pending_generation').not('generated_prompt', 'is', null).limit(BATCH_SIZE);
    if (fetchGenerationError) throw fetchGenerationError;
    if (pendingGenerationTiles && pendingGenerationTiles.length > 0) {
      const generationPromises = pendingGenerationTiles.map(t => supabase.functions.invoke('MIRA-AGENT-worker-tile-generator', { body: { tile_id: t.id } }));
      await Promise.allSettled(generationPromises);
    }

    // Poll queued ComfyUI generations
    const { data: queuedTiles, error: fetchQueuedError } = await supabase.from('mira_agent_tiled_upscale_tiles').select('id, fal_request_id, parent_job_id').eq('status', 'generation_queued').not('fal_request_id', 'is', null).limit(BATCH_SIZE);
    if (fetchQueuedError) throw fetchQueuedError;
    if (queuedTiles && queuedTiles.length > 0) {
      const pipeline = Deno.env.get('FAL_PIPELINE_ID') || 'comfy/research-MIR/test';
      fal.config({ credentials: Deno.env.get('FAL_KEY')! });
      for (const t of queuedTiles) {
        try {
          const st = await fal.queue.status(pipeline, { requestId: t.fal_request_id, logs: false });
          if (st.status === 'COMPLETED') {
            const res: any = await fal.queue.result(pipeline, { requestId: t.fal_request_id });
            const imgAny = res?.image || res?.data?.image || (res?.data?.images && res.data.images[0]) || (res?.images && res.images[0]);
            const url = imgAny?.url || imgAny?.signed_url || imgAny?.href;
            if (!url) throw new Error('No image URL in ComfyUI result payload.');
            const r = await fetch(url);
            if (!r.ok) throw new Error(`Download failed: HTTP ${r.status}`);
            const buf = await r.arrayBuffer();
            const outBucket = 'mira-agent-upscale-tiles';
            const outPath = `${t.fal_request_id}/final.png`;
            await supabase.storage.from(outBucket).upload(outPath, buf, { contentType: 'image/png', upsert: true });
            await supabase.from('mira_agent_tiled_upscale_tiles').update({
              generated_tile_bucket: outBucket,
              generated_tile_path: outPath,
              generated_tile_mime: 'image/png',
              status: 'complete',
              generation_result: res,
              generation_completed_at: new Date().toISOString()
            }).eq('id', t.id);
          } else if (st.status === 'ERROR') {
            await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'generation_failed', error_message: st.error?.toString() || 'Fal job error' }).eq('id', t.id);
          }
        } catch (err: any) {
          console.error(`${logPrefix} Poll error for tile ${t.id}:`, err?.message || err);
        }
      }
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
                console.log(`${logPrefix} Job ${job.id} was claimed by another instance. Skipping invocation.`);
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