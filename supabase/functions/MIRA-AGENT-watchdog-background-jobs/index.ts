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
const STALLED_GOOGLE_VTO_THRESHOLD_SECONDS = 5;
const STALLED_QUEUED_VTO_THRESHOLD_SECONDS = 5;
const STALLED_REFRAME_THRESHOLD_SECONDS = 30;
const STALLED_FIXER_THRESHOLD_SECONDS = 5;
const STALLED_QA_REPORT_THRESHOLD_SECONDS = 5;
const STALLED_CHUNK_WORKER_THRESHOLD_SECONDS = 5;
const STALLED_STYLIST_CHOICE_THRESHOLD_SECONDS = 60;

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

    const recoverStalledJobs = async (tableName: string, statuses: string[], thresholdSeconds: number, workerName: string, idColumnName = 'id', payloadKey = 'job_id') => {
      const threshold = new Date(Date.now() - thresholdSeconds * 1000).toISOString();
      const { data: stalledJobs, error } = await supabase
        .from(tableName)
        .select(idColumnName)
        .in('status', statuses)
        .lt('updated_at', threshold);

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

    // --- Task 1: Handle Stalled BitStudio Pollers ---
    await recoverStalledJobs('mira-agent-bitstudio-jobs', ['queued', 'processing'], STALLED_POLLER_THRESHOLD_SECONDS, 'MIRA-AGENT-poller-bitstudio', 'id', 'job_id');

    // --- Task 2: Trigger Batch Inpaint Worker ---
    console.log(`[Watchdog-BG][${requestId}] === Task 2: Triggering Batch Inpaint Worker ===`);
    const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', {
        body: {} // No job ID passed, worker will claim its own job
    });
    if (invokeError) {
        console.error(`[Watchdog-BG][${requestId}] Task 2: Failed to invoke MIRA-AGENT-worker-batch-inpaint:`, invokeError.message);
    } else {
        console.log(`[Watchdog-BG][${requestId}] Task 2: Successfully invoked batch inpaint worker. The worker will attempt to claim a job.`);
        actionsTaken.push(`Triggered batch inpaint worker.`);
    }

    // --- Task 3: Handle Stalled Segmentation Aggregation Jobs ---
    await recoverStalledJobs('mira-agent-mask-aggregation-jobs', ['aggregating', 'compositing'], STALLED_AGGREGATION_THRESHOLD_SECONDS, 'MIRA-AGENT-compositor-segmentation', 'id', 'job_id');

    // --- Task 4: Handle Stalled Batch Inpainting Pair Jobs ---
    const pairJobThreshold = new Date(Date.now() - STALLED_PAIR_JOB_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledPairJobs, error: stalledPairError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, status, metadata').in('status', ['segmenting', 'delegated', 'processing_step_2']).lt('updated_at', pairJobThreshold);
    if (stalledPairError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled pair jobs:`, stalledPairError.message);
    } else if (stalledPairJobs && stalledPairJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledPairJobs.length} stalled pair job(s). Re-triggering appropriate workers...`);
      const retryPromises = stalledPairJobs.map(async (job) => {
        const { count, error: updateError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({ updated_at: new Date().toISOString() }).eq('id', job.id).lt('updated_at', pairJobThreshold);
        if (updateError || !count) return; // Skip if error or already handled

        if (job.status === 'segmenting') {
          await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', { body: { pair_job_id: job.id } });
        } else if (job.status === 'delegated' && job.metadata?.debug_assets?.expanded_mask_url) {
          await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', { body: { pair_job_id: job.id, final_mask_url: job.metadata.debug_assets.expanded_mask_url } });
        } else if (job.status === 'processing_step_2' && job.metadata?.debug_assets?.expanded_mask_url) {
          await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', { body: { pair_job_id: job.id, final_mask_url: job.metadata.debug_assets.expanded_mask_url } });
        }
      });
      await Promise.allSettled(retryPromises);
      actionsTaken.push(`Re-triggered ${stalledPairJobs.length} stalled pair jobs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled pair jobs found.`);
    }

    // --- Task 5 & 6: Stalled Google VTO Pack Jobs ---
    await recoverStalledJobs('mira-agent-bitstudio-jobs', ['processing', 'awaiting_reframe', 'awaiting_auto_complete', 'queued'], STALLED_GOOGLE_VTO_THRESHOLD_SECONDS, 'MIRA-AGENT-worker-vto-pack-item', 'id', 'pair_job_id');

    // --- Task 7: Manage Concurrent Google VTO Pack Jobs ---
    const { data: config, error: configError } = await supabase.from('mira-agent-config').select('value').eq('key', 'VTO_CONCURRENCY_LIMIT').single();
    if (configError) {
        console.error(`[Watchdog-BG][${requestId}] Could not fetch VTO_CONCURRENCY_LIMIT. Defaulting to 1. Error:`, configError.message);
    }
    const concurrencyLimit = config?.value?.limit || 1;

    const { count: runningJobsCount, error: countError } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id', { count: 'exact' })
        .in('status', ['queued', 'processing', 'awaiting_reframe', 'awaiting_auto_complete', 'fixing'])
        .eq('metadata->>engine', 'google');
    
    if (countError) {
        console.error(`[Watchdog-BG][${requestId}] Could not count running VTO jobs:`, countError.message);
    } else {
        const availableSlots = concurrencyLimit - (runningJobsCount || 0);
        console.log(`[Watchdog-BG][${requestId}] VTO Concurrency: Limit=${concurrencyLimit}, Running=${runningJobsCount}, Available=${availableSlots}`);
        if (availableSlots > 0) {
            const { data: claimedJobs, error: claimError } = await supabase.rpc('claim_multiple_vto_jobs', { p_limit: availableSlots });
            if (claimError) {
                console.error(`[Watchdog-BG][${requestId}] RPC 'claim_multiple_vto_jobs' failed:`, claimError.message);
            } else if (claimedJobs && claimedJobs.length > 0) {
                console.log(`[Watchdog-BG][${requestId}] Claimed ${claimedJobs.length} new VTO jobs. Invoking workers...`);
                const workerPromises = claimedJobs.map((job: { job_id: string }) => 
                    supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: job.job_id } })
                );
                await Promise.allSettled(workerPromises);
                actionsTaken.push(`Started ${claimedJobs.length} new Google VTO workers.`);
            }
        }
    }

    // --- Task 8: Handle VTO Jobs Awaiting Reframe ---
    const { data: awaitingReframeJobs, error: reframeError } = await supabase.from('mira-agent-bitstudio-jobs').select('id, metadata').eq('status', 'awaiting_reframe');
    if (reframeError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for jobs awaiting reframe:`, reframeError.message);
    } else if (awaitingReframeJobs && awaitingReframeJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${awaitingReframeJobs.length} job(s) awaiting reframe. Checking status...`);
      const reframeCheckPromises = awaitingReframeJobs.map(async (vtoJob)=>{
        const reframeJobId = vtoJob.metadata?.delegated_reframe_job_id;
        if (!reframeJobId) return;
        const { data: reframeJob, error: reframeFetchError } = await supabase.from('mira-agent-jobs').select('status, final_result, error_message').eq('id', reframeJobId).single();
        if (reframeFetchError) {
          console.error(`[Watchdog-BG][${requestId}] Could not fetch reframe job ${reframeJobId}:`, reframeFetchError.message);
          return;
        }
        if (reframeJob.status === 'complete') {
          const finalUrl = reframeJob.final_result?.images?.[0]?.publicUrl;
          if (finalUrl) {
            console.log(`[Watchdog-BG][${requestId}] Reframe job ${reframeJobId} is complete. Calling back VTO worker for job ${vtoJob.id}.`);
            await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
              body: {
                pair_job_id: vtoJob.id,
                reframe_result_url: finalUrl
              }
            });
          }
        } else if (reframeJob.status === 'failed') {
          console.error(`[Watchdog-BG][${requestId}] Reframe job ${reframeJobId} failed. Propagating failure to VTO job ${vtoJob.id}.`);
          await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'failed',
            error_message: `Delegated reframe job failed: ${reframeJob.error_message}`
          }).eq('id', vtoJob.id);
        }
      });
      await Promise.allSettled(reframeCheckPromises);
      actionsTaken.push(`Checked status for ${awaitingReframeJobs.length} jobs awaiting reframe.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No jobs awaiting reframe found.`);
    }
    // --- Task 9: Handle Recontext Jobs Awaiting Reframe ---
    const { data: awaitingRecontextJobs, error: recontextError } = await supabase.from('mira-agent-jobs').select('id, context').eq('status', 'awaiting_reframe').eq('context->>source', 'recontext');
    if (recontextError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for recontext jobs awaiting reframe:`, recontextError.message);
    } else if (awaitingRecontextJobs && awaitingRecontextJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${awaitingRecontextJobs.length} recontext job(s) awaiting reframe. Checking status...`);
      const recontextCheckPromises = awaitingRecontextJobs.map(async (recontextJob)=>{
        const reframeJobId = recontextJob.context?.delegated_reframe_job_id;
        if (!reframeJobId) return;
        const { data: reframeJob, error: reframeFetchError } = await supabase.from('mira-agent-jobs').select('status, final_result, error_message').eq('id', reframeJobId).single();
        if (reframeFetchError) {
          console.error(`[Watchdog-BG][${requestId}] Could not fetch reframe job ${reframeJobId}:`, reframeFetchError.message);
          return;
        }
        if (reframeJob.status === 'complete') {
          console.log(`[Watchdog-BG][${requestId}] Reframe job ${reframeJobId} is complete. Finalizing parent recontext job ${recontextJob.id}.`);
          await supabase.from('mira-agent-jobs').update({
            status: 'complete',
            final_result: reframeJob.final_result
          }).eq('id', recontextJob.id);
        } else if (reframeJob.status === 'failed') {
          console.error(`[Watchdog-BG][${requestId}] Reframe job ${reframeJobId} failed. Propagating failure to recontext job ${recontextJob.id}.`);
          await supabase.from('mira-agent-jobs').update({
            status: 'failed',
            error_message: `Delegated reframe job failed: ${reframeJob.error_message}`
          }).eq('id', recontextJob.id);
        }
      });
      await Promise.allSettled(recontextCheckPromises);
      actionsTaken.push(`Checked status for ${awaitingRecontextJobs.length} recontext jobs awaiting reframe.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No recontext jobs awaiting reframe found.`);
    }

    // --- Task 10: Stalled Reframe Worker Jobs ---
    await recoverStalledJobs('mira-agent-jobs', ['processing'], STALLED_REFRAME_THRESHOLD_SECONDS, 'MIRA-AGENT-worker-reframe', 'id', 'job_id');

    // --- Task 11: Handle New VTO QA Jobs ---
    const { data: claimedQaJobId, error: qaRpcError } = await supabase.rpc('claim_next_vto_qa_job');
    if (qaRpcError) {
      console.error(`[Watchdog-BG][${requestId}] RPC 'claim_next_vto_qa_job' failed:`, qaRpcError.message);
    } else if (claimedQaJobId) {
      console.log(`[Watchdog-BG][${requestId}] Claimed VTO QA job ${claimedQaJobId}. Invoking worker.`);
      supabase.functions.invoke('MIRA-AGENT-worker-vto-reporter', { body: { qa_job_id: claimedQaJobId } }).catch(console.error);
      actionsTaken.push(`Started new VTO QA worker for job ${claimedQaJobId}.`);
    }

    // --- Task 12: Handle jobs with expanded masks, ready for step 2 ---
    const { data: readyForStep2Jobs, error: step2Error } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, metadata').eq('status', 'mask_expanded');
    if (step2Error) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for jobs ready for step 2:`, step2Error.message);
    } else if (readyForStep2Jobs && readyForStep2Jobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${readyForStep2Jobs.length} job(s) with expanded masks. Triggering step 2 worker...`);
      const step2Promises = readyForStep2Jobs.map((job)=>{
        const finalMaskUrl = job.metadata?.debug_assets?.expanded_mask_url;
        if (!finalMaskUrl) {
          console.error(`[Watchdog-BG][${requestId}] Job ${job.id} is in 'mask_expanded' state but is missing the expanded_mask_url in metadata. Skipping.`);
          return Promise.resolve();
        }
        return supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', {
          body: {
            pair_job_id: job.id,
            final_mask_url: finalMaskUrl
          }
        });
      });
      await Promise.allSettled(step2Promises);
      actionsTaken.push(`Triggered Step 2 worker for ${readyForStep2Jobs.length} jobs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No jobs ready for step 2 found.`);
    }
    // --- Task 13: Handle Pending VTO Report Chunks ---
    const { data: pendingChunk, error: chunkError } = await supabase.from('mira-agent-vto-report-chunks').select('id').eq('status', 'pending').limit(1).maybeSingle();
    if (chunkError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for pending report chunks:`, chunkError.message);
    } else if (pendingChunk) {
      console.log(`[Watchdog-BG][${requestId}] Found pending report chunk ${pendingChunk.id}. Claiming and invoking worker...`);
      const { error: updateError } = await supabase.from('mira-agent-vto-report-chunks').update({
        status: 'processing'
      }).eq('id', pendingChunk.id);
      if (updateError) {
        console.error(`[Watchdog-BG][${requestId}] Failed to claim chunk ${pendingChunk.id}:`, updateError.message);
      } else {
        supabase.functions.invoke('MIRA-AGENT-analyzer-vto-report-chunk-worker', {
          body: {
            chunk_id: pendingChunk.id
          }
        }).catch(console.error);
        actionsTaken.push(`Triggered VTO report chunk worker for ${pendingChunk.id}.`);
      }
    } else {
      console.log(`[Watchdog-BG][${requestId}] No pending VTO report chunks found.`);
    }
    // --- Task 14: Handle Packs Ready for Synthesis ---
    const { data: readyPacks, error: readyPacksError } = await supabase.rpc('find_packs_ready_for_synthesis');
    if (readyPacksError) {
      console.error(`[Watchdog-BG][${requestId}] Error checking for packs ready for synthesis:`, readyPacksError.message);
    } else if (readyPacks && readyPacks.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${readyPacks.length} pack(s) ready for final synthesis. Invoking synthesizers...`);
      const synthesizerPromises = readyPacks.map((pack)=>supabase.functions.invoke('MIRA-AGENT-final-synthesizer-vto-report', {
          body: {
            pack_id: pack.pack_id
          }
        }));
      await Promise.allSettled(synthesizerPromises);
      actionsTaken.push(`Triggered final synthesis for ${readyPacks.length} VTO report packs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No VTO report packs are ready for final synthesis.`);
    }

    // --- Task 15: Stalled Fixer Jobs ---
    await recoverStalledJobs('mira-agent-bitstudio-jobs', ['awaiting_fix', 'fixing'], STALLED_FIXER_THRESHOLD_SECONDS, 'MIRA-AGENT-fixer-orchestrator', 'id', 'job_id');

    // --- Task 16: Handle Stalled QA Report Jobs ---
    await recoverStalledJobs('mira-agent-vto-qa-reports', ['processing'], STALLED_QA_REPORT_THRESHOLD_SECONDS, 'MIRA-AGENT-worker-vto-reporter', 'id', 'qa_job_id');

    // --- Task 17: Handle Stalled Report Chunk Jobs ---
    await recoverStalledJobs('mira-agent-vto-report-chunks', ['processing'], STALLED_CHUNK_WORKER_THRESHOLD_SECONDS, 'MIRA-AGENT-analyzer-vto-report-chunk-worker', 'id', 'chunk_id');

    // --- Task 18: Handle VTO Jobs Awaiting BitStudio Fallback ---
    const { data: awaitingFallbackJobs, error: fallbackError } = await supabase.from('mira-agent-bitstudio-jobs').select('id, metadata').eq('status', 'awaiting_bitstudio_fallback');
    if (fallbackError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for jobs awaiting fallback:`, fallbackError.message);
    } else if (awaitingFallbackJobs && awaitingFallbackJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${awaitingFallbackJobs.length} job(s) awaiting BitStudio fallback. Checking status...`);
      const fallbackCheckPromises = awaitingFallbackJobs.map(async (vtoJob)=>{
        const bitstudioJobId = vtoJob.metadata?.delegated_bitstudio_job_id;
        if (!bitstudioJobId) return;
        const { data: bitstudioJob, error: bitstudioFetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('status, final_image_url, error_message').eq('id', bitstudioJobId).single();
        if (bitstudioFetchError) {
          console.error(`[Watchdog-BG][${requestId}] Could not fetch delegated BitStudio job ${bitstudioJobId}:`, bitstudioFetchError.message);
          return;
        }
        if (bitstudioJob.status === 'complete') {
          console.log(`[Watchdog-BG][${requestId}] BitStudio fallback job ${bitstudioJobId} is complete. Calling back VTO worker for job ${vtoJob.id}.`);
          await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
            body: {
              pair_job_id: vtoJob.id,
              bitstudio_result_url: bitstudioJob.final_image_url
            }
          });
        } else if (bitstudioJob.status === 'failed' || bitstudioJob.status === 'permanently_failed') {
          console.error(`[Watchdog-BG][${requestId}] BitStudio fallback job ${bitstudioJobId} failed. Propagating failure to VTO job ${vtoJob.id}.`);
          await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'failed',
            error_message: `Delegated BitStudio fallback job failed: ${bitstudioJob.error_message}`
          }).eq('id', vtoJob.id);
        }
      });
      await Promise.allSettled(fallbackCheckPromises);
      actionsTaken.push(`Checked status for ${awaitingFallbackJobs.length} jobs awaiting BitStudio fallback.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No jobs awaiting BitStudio fallback found.`);
    }
    // --- Task 19: Handle jobs awaiting auto-complete ---
    const { data: awaitingAutoCompleteJobs, error: autoCompleteError } = await supabase.from('mira-agent-bitstudio-jobs').select('id, metadata').eq('status', 'awaiting_auto_complete');
    if (autoCompleteError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for jobs awaiting auto-complete:`, autoCompleteError.message);
    } else if (awaitingAutoCompleteJobs && awaitingAutoCompleteJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${awaitingAutoCompleteJobs.length} job(s) awaiting auto-complete. Checking status...`);
      const autoCompleteCheckPromises = awaitingAutoCompleteJobs.map(async (parentJob)=>{
        const childJobId = parentJob.metadata?.delegated_auto_complete_job_id;
        if (!childJobId) {
          console.error(`[Watchdog-BG][${requestId}] Parent job ${parentJob.id} is awaiting auto-complete but has no child job ID. Marking as failed.`);
          await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'failed',
            error_message: 'Missing child job ID for auto-complete.'
          }).eq('id', parentJob.id);
          return;
        }
        const { data: childJob, error: childFetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('status, final_image_url, error_message').eq('id', childJobId).single();
        if (childFetchError) {
          console.error(`[Watchdog-BG][${requestId}] Could not fetch child job ${childJobId}:`, childFetchError.message);
          return;
        }
        if (childJob.status === 'complete') {
          console.log(`[Watchdog-BG][${requestId}] Child job ${childJobId} is complete. Finalizing parent job ${parentJob.id}.`);
          await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'complete',
            final_image_url: childJob.final_image_url,
            metadata: {
              ...parentJob.metadata,
              final_auto_complete_job_id: childJobId
            }
          }).eq('id', parentJob.id);
        } else if (childJob.status === 'failed' || childJob.status === 'permanently_failed') {
          console.error(`[Watchdog-BG][${requestId}] Child job ${childJobId} failed. Propagating failure to parent job ${parentJob.id}.`);
          await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'failed',
            error_message: `Delegated auto-complete job failed: ${childJob.error_message}`
          }).eq('id', parentJob.id);
        }
      });
      await Promise.allSettled(autoCompleteCheckPromises);
      actionsTaken.push(`Checked status for ${awaitingAutoCompleteJobs.length} jobs awaiting auto-complete.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No jobs awaiting auto-complete found.`);
    }
    // --- Task 20: Handle jobs that have received a stylist choice and are ready for auto-complete ---
    const { data: readyForAutoComplete, error: readyForAutoCompleteError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id')
      .eq('status', 'awaiting_auto_complete');

    if (readyForAutoCompleteError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for jobs ready for auto-complete:`, readyForAutoCompleteError.message);
    } else if (readyForAutoComplete && readyForAutoComplete.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${readyForAutoComplete.length} job(s) ready for auto-complete. Re-triggering workers...`);
      const autoCompletePromises = readyForAutoComplete.map(job => 
        supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
          body: { pair_job_id: job.id }
        })
      );
      await Promise.allSettled(autoCompletePromises);
      actionsTaken.push(`Re-triggered ${readyForAutoComplete.length} workers for auto-complete.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No jobs ready for auto-complete found.`);
    }
    
    // --- Task 21: Handle Stalled Stylist Choice Jobs ---
    await recoverStalledJobs('mira-agent-bitstudio-jobs', ['awaiting_stylist_choice'], STALLED_STYLIST_CHOICE_THRESHOLD_SECONDS, 'MIRA-AGENT-worker-vto-pack-item', 'id', 'pair_job_id');

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