import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALLED_POLLER_THRESHOLD_SECONDS = 5;
const STALLED_AGGREGATION_THRESHOLD_SECONDS = 20;
const STALLED_PAIR_JOB_THRESHOLD_SECONDS = 30;
const STALLED_GOOGLE_VTO_THRESHOLD_SECONDS = 15;
const STALLED_REFRAME_THRESHOLD_SECONDS = 30;
const STALLED_FIXER_THRESHOLD_SECONDS = 5;
const STALLED_QA_REPORT_THRESHOLD_SECONDS = 5;
const STALLED_CHUNK_WORKER_THRESHOLD_SECONDS = 5;
const STALLED_STYLIST_CHOICE_THRESHOLD_SECONDS = 60;
const STALLED_VTO_WORKER_CATCH_ALL_THRESHOLD_SECONDS = 120; // 2 minutes
const MAX_WATCHDOG_RETRIES = 3;

serve(async (req) => {
  const requestId = `watchdog-bg-${Date.now()}`;
  console.log(`[Watchdog-BG][${requestId}] Invocation attempt.`);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: lockAcquired, error: lockError } = await supabase.rpc('try_acquire_watchdog_lock');
    if (lockError) {
      console.error(`[Watchdog-BG][${requestId}] Error acquiring advisory lock:`, lockError.message);
      throw lockError;
    }
    if (!lockAcquired) {
      console.log(`[Watchdog-BG][${requestId}] Advisory lock is held by another process. Exiting gracefully.`);
      return new Response(JSON.stringify({ message: "Lock held, skipping execution." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }
    console.log(`[Watchdog-BG][${requestId}] Advisory lock acquired. Proceeding with checks.`);
    const actionsTaken: string[] = [];

    const recoverStalledJobs = async (tableName: string, statuses: string[], thresholdSeconds: number, workerName: string, idColumnName = 'id', payloadKey = 'job_id', extraFilters: Record<string, any> = {}) => {
      const threshold = new Date(Date.now() - thresholdSeconds * 1000).toISOString();
      let query = supabase
        .from(tableName)
        .select(idColumnName)
        .in('status', statuses)
        .lt('updated_at', threshold);

      for (const key in extraFilters) {
        const filterValue = extraFilters[key];
        if (Array.isArray(filterValue)) {
          query = query.in(key, filterValue);
        } else {
          query = query.eq(key, filterValue);
        }
      }

      const { data: stalledJobs, error } = await query;

      if (error) {
        console.error(`[Watchdog-BG][${requestId}] Error querying stalled jobs in ${tableName}:`, error.message);
        return;
      }

      if (stalledJobs && stalledJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${stalledJobs.length} stalled job(s) in ${tableName}. Attempting recovery...`);
        const recoveryPromises = stalledJobs.map(async (job) => {
          const jobId = job[idColumnName];
          const { count, error: updateError } = await supabase
            .from(tableName)
            .update({ updated_at: new Date().toISOString() })
            .eq(idColumnName, jobId)
            .lt('updated_at', threshold);

          if (updateError) {
            console.error(`[Watchdog-BG][${requestId}] Error touching stalled job ${jobId} in ${tableName}:`, updateError.message);
            return;
          }

          if (count && count > 0) {
            console.log(`[Watchdog-BG][${requestId}] Claimed stalled job ${jobId}. Invoking ${workerName}.`);
            await supabase.functions.invoke(workerName, { body: { [payloadKey]: jobId } });
          } else {
            console.log(`[Watchdog-BG][${requestId}] Stalled job ${jobId} was already handled. Skipping.`);
          }
        });
        await Promise.allSettled(recoveryPromises);
        actionsTaken.push(`Attempted recovery for ${stalledJobs.length} stalled jobs in ${tableName}.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No stalled jobs found in ${tableName}.`);
      }
    };

    // --- Each task is now wrapped in its own try/catch block for maximum resilience ---
    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 1: Recovering BitStudio Pollers ===`);
      await recoverStalledJobs('mira-agent-bitstudio-jobs', ['queued', 'processing'], STALLED_POLLER_THRESHOLD_SECONDS, 'MIRA-AGENT-poller-bitstudio', 'id', 'job_id', { 'metadata->>engine': ['bitstudio', 'bitstudio_fallback'] });
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 1 (BitStudio Pollers) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 2: Triggering Batch Inpaint Worker ===`);
      const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', { body: {} });
      if (invokeError) throw invokeError;
      console.log(`[Watchdog-BG][${requestId}] Task 2: Successfully invoked batch inpaint worker.`);
      actionsTaken.push(`Triggered batch inpaint worker.`);
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 2 (Batch Inpaint) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 3: Recovering STALLED Segmentation Aggregation ===`);
      await recoverStalledJobs('mira-agent-mask-aggregation-jobs', ['aggregating', 'compositing'], STALLED_AGGREGATION_THRESHOLD_SECONDS, 'MIRA-AGENT-compositor-segmentation', 'id', 'job_id');
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 3 (Stalled Segmentation Aggregation) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 4: Triggering COMPLETED Segmentation Aggregation ===`);
      
      const { data: readyJobs, error: rpcError } = await supabase
        .rpc('find_aggregation_jobs_ready_for_compositor');

      if (rpcError) {
        console.error(`[Watchdog-BG][${requestId}] Error calling find_aggregation_jobs_ready_for_compositor RPC:`, rpcError.message);
        throw rpcError;
      }

      if (readyJobs && readyJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${readyJobs.length} aggregation job(s) ready for compositing.`);
        
        const compositorPromises = readyJobs.map(job => {
          console.log(`[Watchdog-BG][${requestId}] Invoking compositor for job ${job.job_id}.`);
          return supabase.functions.invoke('MIRA-AGENT-compositor-segmentation', {
            body: { job_id: job.job_id }
          });
        });

        await Promise.allSettled(compositorPromises);
        actionsTaken.push(`Triggered compositor for ${readyJobs.length} completed aggregation jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No aggregation jobs ready for compositing.`);
      }
    } catch (e) { 
      console.error(`[Watchdog-BG][${requestId}] Task 4 (Completed Aggregations) failed:`, e.message); 
    }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 5: Recovering Stalled Pair Jobs ===`);
      const pairJobThreshold = new Date(Date.now() - STALLED_PAIR_JOB_THRESHOLD_SECONDS * 1000).toISOString();
      const { data: stalledPairJobs, error: stalledPairError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, status, metadata').in('status', ['segmenting', 'delegated', 'processing_step_2']).lt('updated_at', pairJobThreshold);
      if (stalledPairError) throw stalledPairError;
      if (stalledPairJobs && stalledPairJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${stalledPairJobs.length} stalled pair job(s). Re-triggering appropriate workers...`);
        const retryPromises = stalledPairJobs.map(async (job) => {
          const { count, error: updateError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({ updated_at: new Date().toISOString() }).eq('id', job.id).lt('updated_at', pairJobThreshold);
          if (updateError || !count) return; // Skip if error or already handled

          if (job.status === 'segmenting') {
            await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', { body: { pair_job_id: job.id } });
          } else if ((job.status === 'delegated' || job.status === 'processing_step_2') && job.metadata?.debug_assets?.expanded_mask_url) {
            await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', { body: { pair_job_id: job.id, final_mask_url: job.metadata.debug_assets.expanded_mask_url } });
          }
        });
        await Promise.allSettled(retryPromises);
        actionsTaken.push(`Re-triggered ${stalledPairJobs.length} stalled pair jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No stalled pair jobs found.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 5 (Stalled Pair Jobs) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 6: Recovering Stalled Google VTO ===`);
      await recoverStalledJobs('mira-agent-bitstudio-jobs', ['processing', 'fixing', 'prepare_assets', 'awaiting_auto_complete'], STALLED_GOOGLE_VTO_THRESHOLD_SECONDS, 'MIRA-AGENT-worker-vto-pack-item', 'id', 'pair_job_id', { 'metadata->>engine': 'google' });
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 6 (Stalled Google VTO) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 7: Generic VTO Worker Catch-All ===`);
      const catchAllThreshold = new Date(Date.now() - STALLED_VTO_WORKER_CATCH_ALL_THRESHOLD_SECONDS * 1000).toISOString();
      const inProgressStatuses = ['processing', 'fixing', 'prepare_assets', 'awaiting_auto_complete', 'awaiting_reframe', 'awaiting_stylist_choice'];
      const { data: longStalledJobs, error: catchAllError } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id, metadata')
        .in('status', inProgressStatuses)
        .eq('metadata->>engine', 'google')
        .lt('updated_at', catchAllThreshold);

      if (catchAllError) throw catchAllError;

      if (longStalledJobs && longStalledJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${longStalledJobs.length} long-stalled job(s). Applying retry/fail logic...`);
        const recoveryPromises = longStalledJobs.map(async (job) => {
          const retries = (job.metadata?.watchdog_retries || 0) + 1;
          if (retries > MAX_WATCHDOG_RETRIES) {
            console.error(`[Watchdog-BG][${requestId}] Job ${job.id} has exceeded max watchdog retries. Marking as permanently failed.`);
            await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'permanently_failed', error_message: `Job stalled and failed after ${MAX_WATCHDOG_RETRIES} watchdog recovery attempts.` }).eq('id', job.id);
          } else {
            console.log(`[Watchdog-BG][${requestId}] Re-triggering worker for long-stalled job ${job.id} (Attempt ${retries}/${MAX_WATCHDOG_RETRIES}).`);
            await supabase.from('mira-agent-bitstudio-jobs').update({ metadata: { ...job.metadata, watchdog_retries: retries } }).eq('id', job.id);
            await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: job.id } });
          }
        });
        await Promise.allSettled(recoveryPromises);
        actionsTaken.push(`Processed ${longStalledJobs.length} long-stalled VTO jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No long-stalled VTO jobs found.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 7 (VTO Catch-All) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 8: Starting New Google VTO Jobs ===`);
      const { data: config } = await supabase.from('mira-agent-config').select('value').eq('key', 'VTO_CONCURRENCY_LIMIT').single();
      const concurrencyLimit = config?.value?.limit || 1;
      const { count: runningJobsCount } = await supabase.from('mira-agent-bitstudio-jobs').select('id', { count: 'exact' }).in('status', ['processing', 'fixing', 'prepare_assets']).eq('metadata->>engine', 'google');
      const availableSlots = concurrencyLimit - (runningJobsCount || 0);
      if (availableSlots > 0) {
        const { data: jobsToStart, error: claimError } = await supabase
            .rpc('claim_next_vto_google_jobs', { p_limit: availableSlots });
        if (claimError) throw claimError;

        if (jobsToStart && jobsToStart.length > 0) {
          const workerPromises = jobsToStart.map((job: { job_id: string }) => supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: job.job_id } }));
          await Promise.allSettled(workerPromises);
          actionsTaken.push(`Started ${jobsToStart.length} new Google VTO workers.`);
        } else {
          console.log(`[Watchdog-BG][${requestId}] No new pending Google VTO jobs to start.`);
        }
      } else {
        console.log(`[Watchdog-BG][${requestId}] No available concurrency slots for Google VTO.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 8 (VTO Concurrency & Start) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 9: Checking Jobs Awaiting Reframe ===`);
      const { data: awaitingReframeJobs } = await supabase.from('mira-agent-bitstudio-jobs').select('id, metadata').eq('status', 'awaiting_reframe');
      if (awaitingReframeJobs && awaitingReframeJobs.length > 0) {
        const reframeCheckPromises = awaitingReframeJobs.map(async (vtoJob)=>{
          const reframeJobId = vtoJob.metadata?.delegated_reframe_job_id;
          if (!reframeJobId) return;
          const { data: reframeJob } = await supabase.from('mira-agent-jobs').select('status, final_result, error_message').eq('id', reframeJobId).single();
          if (reframeJob?.status === 'complete') await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: vtoJob.id, reframe_result_url: reframeJob.final_result?.images?.[0]?.publicUrl } });
          else if (reframeJob?.status === 'failed') await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Delegated reframe job failed: ${reframeJob.error_message}` }).eq('id', vtoJob.id);
        });
        await Promise.allSettled(reframeCheckPromises);
        actionsTaken.push(`Checked ${awaitingReframeJobs.length} jobs awaiting reframe.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No jobs awaiting reframe.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 9 (VTO Reframe Check) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 10: Checking Recontext Jobs Awaiting Reframe ===`);
      const { data: awaitingRecontextJobs } = await supabase.from('mira-agent-jobs').select('id, context').eq('status', 'awaiting_reframe').eq('context->>source', 'recontext');
      if (awaitingRecontextJobs && awaitingRecontextJobs.length > 0) {
        const recontextCheckPromises = awaitingRecontextJobs.map(async (recontextJob)=>{
          const reframeJobId = recontextJob.context?.delegated_reframe_job_id;
          if (!reframeJobId) return;
          const { data: reframeJob } = await supabase.from('mira-agent-jobs').select('status, final_result, error_message').eq('id', reframeJobId).single();
          if (reframeJob?.status === 'complete') await supabase.from('mira-agent-jobs').update({ status: 'complete', final_result: reframeJob.final_result }).eq('id', recontextJob.id);
          else if (reframeJob?.status === 'failed') await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: `Delegated reframe job failed: ${reframeJob.error_message}` }).eq('id', recontextJob.id);
        });
        await Promise.allSettled(recontextCheckPromises);
        actionsTaken.push(`Checked ${awaitingRecontextJobs.length} recontext jobs awaiting reframe.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No recontext jobs awaiting reframe.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 10 (Recontext Reframe Check) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 11: Recovering Stalled Reframe Jobs (Processing) ===`);
      await recoverStalledJobs('mira-agent-jobs', ['processing'], STALLED_REFRAME_THRESHOLD_SECONDS, 'MIRA-AGENT-worker-reframe', 'id', 'job_id');
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 11 (Stalled Processing Reframe) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 12: Recovering Stalled Reframe Jobs (Awaiting) ===`);
      await recoverStalledJobs('mira-agent-jobs', ['awaiting_reframe'], STALLED_REFRAME_THRESHOLD_SECONDS, 'MIRA-AGENT-worker-reframe', 'id', 'job_id');
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 12 (Stalled Awaiting Reframe) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 13: Starting New QA Jobs ===`);
      const { data: claimedQaJobId } = await supabase.rpc('claim_next_vto_qa_job');
      if (claimedQaJobId) {
        supabase.functions.invoke('MIRA-AGENT-worker-vto-reporter', { body: { qa_job_id: claimedQaJobId } }).catch(console.error);
        actionsTaken.push(`Started new VTO QA worker for job ${claimedQaJobId}.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No new QA jobs to start.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 13 (New QA Jobs) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 14: Triggering Step 2 for Expanded Masks ===`);
      const { data: readyForStep2Jobs } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, metadata').eq('status', 'mask_expanded');
      if (readyForStep2Jobs && readyForStep2Jobs.length > 0) {
        const step2Promises = readyForStep2Jobs.map((job)=>{
          const finalMaskUrl = job.metadata?.debug_assets?.expanded_mask_url;
          if (!finalMaskUrl) return Promise.resolve();
          return supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', { body: { pair_job_id: job.id, final_mask_url: finalMaskUrl } });
        });
        await Promise.allSettled(step2Promises);
        actionsTaken.push(`Triggered Step 2 worker for ${readyForStep2Jobs.length} jobs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No jobs ready for Step 2.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 14 (Step 2 Jobs) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 15: Triggering Report Chunk Workers ===`);
      const { data: pendingChunk } = await supabase.from('mira-agent-vto-report-chunks').select('id').eq('status', 'pending').limit(1).maybeSingle();
      if (pendingChunk) {
        const { error: updateError } = await supabase.from('mira-agent-vto-report-chunks').update({ status: 'processing' }).eq('id', pendingChunk.id);
        if (!updateError) {
          supabase.functions.invoke('MIRA-AGENT-analyzer-vto-report-chunk-worker', { body: { chunk_id: pendingChunk.id } }).catch(console.error);
          actionsTaken.push(`Triggered VTO report chunk worker for ${pendingChunk.id}.`);
        }
      } else {
        console.log(`[Watchdog-BG][${requestId}] No pending report chunks to process.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 15 (Report Chunks) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 16: Triggering Final Synthesis ===`);
      const { data: readyPacks } = await supabase.rpc('find_packs_ready_for_synthesis');
      if (readyPacks && readyPacks.length > 0) {
        const synthesizerPromises = readyPacks.map((pack)=>supabase.functions.invoke('MIRA-AGENT-final-synthesizer-vto-report', { body: { pack_id: pack.pack_id } }));
        await Promise.allSettled(synthesizerPromises);
        actionsTaken.push(`Triggered final synthesis for ${readyPacks.length} VTO report packs.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No packs ready for final synthesis.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 16 (Synthesis) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 17: Recovering Stalled Fixer Jobs ===`);
      await recoverStalledJobs('mira-agent-bitstudio-jobs', ['awaiting_fix', 'fixing'], STALLED_FIXER_THRESHOLD_SECONDS, 'MIRA-AGENT-fixer-orchestrator', 'id', 'job_id');
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 17 (Stalled Fixer) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 18: Recovering Stalled QA Reports ===`);
      await recoverStalledJobs('mira-agent-vto-qa-reports', ['processing'], STALLED_QA_REPORT_THRESHOLD_SECONDS, 'MIRA-AGENT-worker-vto-reporter', 'id', 'qa_job_id');
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 18 (Stalled QA) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 19: Recovering Stalled Report Chunks ===`);
      await recoverStalledJobs('mira-agent-vto-report-chunks', ['processing'], STALLED_CHUNK_WORKER_THRESHOLD_SECONDS, 'MIRA-AGENT-analyzer-vto-report-chunk-worker', 'id', 'chunk_id');
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 19 (Stalled Chunks) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 20: Checking BitStudio Fallback Jobs ===`);
      const { data: awaitingFallbackJobs } = await supabase.from('mira-agent-bitstudio-jobs').select('id, metadata').eq('status', 'awaiting_bitstudio_fallback');
      if (awaitingFallbackJobs && awaitingFallbackJobs.length > 0) {
        const fallbackCheckPromises = awaitingFallbackJobs.map(async (vtoJob)=>{
          const bitstudioJobId = vtoJob.metadata?.delegated_bitstudio_job_id;
          if (!bitstudioJobId) return;
          const { data: bitstudioJob } = await supabase.from('mira-agent-bitstudio-jobs').select('status, final_image_url, error_message').eq('id', bitstudioJobId).single();
          if (bitstudioJob?.status === 'complete') await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: vtoJob.id, bitstudio_result_url: bitstudioJob.final_image_url } });
          else if (bitstudioJob?.status === 'failed' || bitstudioJob?.status === 'permanently_failed') await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Delegated BitStudio fallback job failed: ${bitstudioJob.error_message}` }).eq('id', vtoJob.id);
        });
        await Promise.allSettled(fallbackCheckPromises);
        actionsTaken.push(`Checked ${awaitingFallbackJobs.length} jobs awaiting BitStudio fallback.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No jobs awaiting BitStudio fallback.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 20 (BitStudio Fallback) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 21: Checking Auto-Complete Jobs ===`);
      const { data: awaitingAutoCompleteJobs } = await supabase.from('mira-agent-bitstudio-jobs').select('id, metadata').eq('status', 'awaiting_auto_complete');
      if (awaitingAutoCompleteJobs && awaitingAutoCompleteJobs.length > 0) {
        const autoCompleteCheckPromises = awaitingAutoCompleteJobs.map(async (parentJob)=>{
          const childJobId = parentJob.metadata?.delegated_auto_complete_job_id;
          if (!childJobId) {
            await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: 'Missing child job ID for auto-complete.' }).eq('id', parentJob.id);
            return;
          }
          const { data: childJob } = await supabase.from('mira-agent-bitstudio-jobs').select('status, final_image_url, error_message').eq('id', childJobId).single();
          if (childJob?.status === 'complete') await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'complete', final_image_url: childJob.final_image_url, metadata: { ...parentJob.metadata, final_auto_complete_job_id: childJobId } }).eq('id', parentJob.id);
          else if (childJob?.status === 'failed' || childJob?.status === 'permanently_failed') await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Delegated auto-complete job failed: ${childJob.error_message}` }).eq('id', parentJob.id);
        });
        await Promise.allSettled(autoCompleteCheckPromises);
        actionsTaken.push(`Checked ${awaitingAutoCompleteJobs.length} jobs awaiting auto-complete.`);
      } else {
        console.log(`[Watchdog-BG][${requestId}] No jobs awaiting auto-complete.`);
      }
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 21 (Auto-Complete Check) failed:`, e.message); }

    try {
      console.log(`[Watchdog-BG][${requestId}] === Task 22: Recovering Stalled Stylist Jobs ===`);
      await recoverStalledJobs('mira-agent-bitstudio-jobs', ['awaiting_stylist_choice'], STALLED_STYLIST_CHOICE_THRESHOLD_SECONDS, 'MIRA-AGENT-stylist-chooser', 'id', 'pair_job_id');
    } catch (e) { console.error(`[Watchdog-BG][${requestId}] Task 22 (Stalled Stylist) failed:`, e.message); }

    const finalMessage = actionsTaken.length > 0 ? actionsTaken.join(' ') : "No actions required. All jobs are running normally.";
    console.log(`[Watchdog-BG][${requestId}] Check complete. ${finalMessage}`);
    return new Response(JSON.stringify({ message: finalMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error(`[Watchdog-BG][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});