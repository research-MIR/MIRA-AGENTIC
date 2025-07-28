import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
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
        return new Response(JSON.stringify({ message: "Lock held, skipping execution." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }
    
    console.log(`[Watchdog-BG][${requestId}] Advisory lock acquired. Proceeding with checks.`);

    let actionsTaken = [];
    
    // --- Task 1: Handle Stalled BitStudio Pollers ---
    const pollerThreshold = new Date(Date.now() - STALLED_POLLER_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledJobs, error: stalledError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id')
      .in('status', ['queued', 'processing'])
      .lt('last_polled_at', pollerThreshold)
      .not('bitstudio_task_id', 'is', null);

    if (stalledError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled jobs:`, stalledError.message);
    } else if (stalledJobs && stalledJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledJobs.length} stalled BitStudio job(s). Re-triggering pollers...`);
      const pollerPromises = stalledJobs.map((job)=>supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', {
          body: {
            job_id: job.id
          }
        }));
      await Promise.allSettled(pollerPromises);
      actionsTaken.push(`Re-triggered ${stalledJobs.length} stalled BitStudio pollers.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled BitStudio jobs found.`);
    }

    // --- Task 2: Handle New Pending Batch Inpainting Jobs ---
    console.log(`[Watchdog-BG][${requestId}] === Task 2: Managing Batch Inpaint Job Slot via RPC ===`);
    const { data: claimedBatchJobId, error: batchRpcError } = await supabase.rpc('claim_next_batch_inpaint_job');
    if (batchRpcError) {
        console.error(`[Watchdog-BG][${requestId}] Task 2: RPC 'claim_next_batch_inpaint_job' failed:`, batchRpcError.message);
    } else if (claimedBatchJobId) {
        console.log(`[Watchdog-BG][${requestId}] Task 2: Successfully claimed batch inpaint job ${claimedBatchJobId} via RPC. Invoking worker.`);
        const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', {
            body: { pair_job_id: claimedBatchJobId }
        });
        if (invokeError) {
            console.error(`[Watchdog-BG][${requestId}] Task 2: CRITICAL! Failed to invoke worker for claimed job ${claimedBatchJobId}:`, invokeError);
            await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
                status: 'pending',
                error_message: 'Watchdog failed to invoke worker.'
            }).eq('id', claimedBatchJobId);
        } else {
            actionsTaken.push(`Started new batch inpaint worker for job ${claimedBatchJobId}.`);
        }
    } else {
        console.log(`[Watchdog-BG][${requestId}] Task 2: No pending batch inpaint jobs found to claim.`);
    }

    // --- Task 3: Handle Stalled Segmentation Aggregation Jobs ---
    const segmentationThreshold = new Date(Date.now() - STALLED_AGGREGATION_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledAggregationJobs, error: aggregationError } = await supabase.from('mira-agent-mask-aggregation-jobs').select('id, results').in('status', [
      'aggregating',
      'compositing'
    ]).lt('updated_at', segmentationThreshold);
    if (aggregationError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled aggregation jobs:`, aggregationError.message);
    } else if (stalledAggregationJobs && stalledAggregationJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledAggregationJobs.length} stalled aggregation job(s). Forcing composition...`);
      const compositorPromises = stalledAggregationJobs.map(async (job)=>{
        console.log(`[Watchdog-BG][${requestId}] Forcing compositor for job ${job.id}. It has ${job.results?.length || 0} results.`);
        await supabase.from('mira-agent-mask-aggregation-jobs').update({
          status: 'compositing'
        }).eq('id', job.id);
        return supabase.functions.invoke('MIRA-AGENT-compositor-segmentation', {
          body: {
            job_id: job.id
          }
        });
      });
      await Promise.allSettled(compositorPromises);
      actionsTaken.push(`Forced composition for ${stalledAggregationJobs.length} stalled aggregation jobs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled aggregation jobs found.`);
    }

    // --- Task 4: Handle Stalled Batch Inpainting Pair Jobs ---
    const pairJobThreshold = new Date(Date.now() - STALLED_PAIR_JOB_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledPairJobs, error: stalledPairError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, status, metadata').in('status', [
      'segmenting',
      'delegated',
      'processing_step_2'
    ]).lt('updated_at', pairJobThreshold);
    if (stalledPairError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled pair jobs:`, stalledPairError.message);
    } else if (stalledPairJobs && stalledPairJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledPairJobs.length} stalled pair job(s). Re-triggering appropriate workers...`);
      const retryPromises = stalledPairJobs.map((job)=>{
        if (job.status === 'segmenting') {
          console.log(`[Watchdog-BG][${requestId}] Re-triggering Step 1 (segmentation) for job ${job.id}`);
          return supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', {
            body: {
              pair_job_id: job.id
            }
          });
        } else if (job.status === 'delegated' && job.metadata?.debug_assets?.expanded_mask_url) {
          console.log(`[Watchdog-BG][${requestId}] Re-triggering Step 2 (inpainting) for job ${job.id}`);
          return supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', {
            body: {
              pair_job_id: job.id,
              final_mask_url: job.metadata.debug_assets.expanded_mask_url
            }
          });
        } else if (job.status === 'processing_step_2') {
          console.log(`[Watchdog-BG][${requestId}] Re-triggering Step 2 (inpainting) for job ${job.id} stuck in processing.`);
          const finalMaskUrl = job.metadata?.debug_assets?.expanded_mask_url;
          if (!finalMaskUrl) {
            console.error(`[Watchdog-BG][${requestId}] Cannot retry job ${job.id} stuck in step 2 because expanded_mask_url is missing.`);
            return Promise.resolve();
          }
          return supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', {
            body: {
              pair_job_id: job.id,
              final_mask_url: finalMaskUrl
            }
          });
        }
        return Promise.resolve();
      });
      await Promise.allSettled(retryPromises);
      actionsTaken.push(`Re-triggered ${stalledPairJobs.length} stalled pair jobs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled pair jobs found.`);
    }

    // --- Task 5: Handle Stalled 'processing', 'awaiting_reframe' Google VTO Pack Jobs ---
    const googleVtoThreshold = new Date(Date.now() - STALLED_GOOGLE_VTO_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledGoogleVtoJobs, error: googleVtoError } = await supabase.from('mira-agent-bitstudio-jobs').select('id').eq('metadata->>engine', 'google').in('status', ['processing', 'awaiting_reframe']).lt('updated_at', googleVtoThreshold);
    if (googleVtoError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled Google VTO jobs:`, googleVtoError.message);
    } else if (stalledGoogleVtoJobs && stalledGoogleVtoJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledGoogleVtoJobs.length} stalled Google VTO job(s). Re-triggering workers...`);
      const workerPromises = stalledGoogleVtoJobs.map((job)=>supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
          body: {
            pair_job_id: job.id
          }
        }));
      await Promise.allSettled(workerPromises);
      actionsTaken.push(`Re-triggered ${stalledGoogleVtoJobs.length} stalled Google VTO workers.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled 'processing' or 'awaiting_reframe' Google VTO jobs found.`);
    }

    // --- Task 6: Handle Stalled 'queued' Google VTO Pack Jobs ---
    const queuedVtoThreshold = new Date(Date.now() - STALLED_QUEUED_VTO_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: queuedGoogleVtoJobs, error: queuedVtoError } = await supabase.from('mira-agent-bitstudio-jobs').select('id').eq('metadata->>engine', 'google').eq('status', 'queued').lt('updated_at', queuedVtoThreshold);
    if (queuedVtoError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled 'queued' Google VTO jobs:`, queuedVtoError.message);
    } else if (queuedGoogleVtoJobs && queuedGoogleVtoJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${queuedGoogleVtoJobs.length} stalled 'queued' Google VTO job(s). Re-invoking workers...`);
      const jobIdsToStart = queuedGoogleVtoJobs.map((j)=>j.id);
      const workerPromises = jobIdsToStart.map((jobId)=>supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
          body: {
            pair_job_id: jobId
          }
        }));
      await Promise.allSettled(workerPromises);
      actionsTaken.push(`Re-invoked ${queuedGoogleVtoJobs.length} stalled 'queued' Google VTO workers.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled 'queued' Google VTO jobs found.`);
    }

    // --- Task 7: Manage Single Google VTO Pack Job Slot ---
    console.log(`[Watchdog-BG][${requestId}] === Task 7: Managing Google VTO Pack Job Slot via RPC ===`);
    const { data: claimedVtoJobId, error: vtoRpcError } = await supabase.rpc('claim_next_google_vto_job');
    if (vtoRpcError) {
        console.error(`[Watchdog-BG][${requestId}] Task 7: RPC 'claim_next_google_vto_job' failed:`, vtoRpcError.message);
    } else if (claimedVtoJobId) {
        console.log(`[Watchdog-BG][${requestId}] Task 7: Successfully claimed job ${claimedVtoJobId} via RPC. Invoking worker.`);
        const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
            body: { pair_job_id: claimedVtoJobId }
        });
        if (invokeError) {
            console.error(`[Watchdog-BG][${requestId}] Task 7: CRITICAL! Failed to invoke worker for claimed job ${claimedVtoJobId}:`, invokeError);
            await supabase.from('mira-agent-bitstudio-jobs').update({
                status: 'pending',
                error_message: 'Watchdog failed to invoke worker.'
            }).eq('id', claimedVtoJobId);
        } else {
            console.log(`[Watchdog-BG][${requestId}] Task 7: Successfully invoked worker for job ${claimedVtoJobId}.`);
            actionsTaken.push(`Started new Google VTO worker for job ${claimedVtoJobId}.`);
        }
    } else {
        console.log(`[Watchdog-BG][${requestId}] Task 7: No pending job was claimed. The slot is either busy or the queue is empty.`);
    }
    console.log(`[Watchdog-BG][${requestId}] === Task 7: Finished ===`);

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

    // --- Task 10: Handle Stalled Reframe Worker Jobs ---
    const reframeThreshold = new Date(Date.now() - STALLED_REFRAME_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledReframeJobs, error: stalledReframeError } = await supabase.from('mira-agent-jobs').select('id').eq('status', 'processing').in('context->>source', [
      'reframe',
      'reframe_from_recontext',
      'reframe_from_vto'
    ]).lt('updated_at', reframeThreshold);
    if (stalledReframeError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled reframe jobs:`, stalledReframeError.message);
    } else if (stalledReframeJobs && stalledReframeJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledReframeJobs.length} stalled reframe job(s). Re-triggering workers...`);
      const reframeWorkerPromises = stalledReframeJobs.map((job)=>supabase.functions.invoke('MIRA-AGENT-worker-reframe', {
          body: {
            job_id: job.id
          }
        }));
      await Promise.allSettled(reframeWorkerPromises);
      actionsTaken.push(`Re-triggered ${stalledReframeJobs.length} stalled reframe workers.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled reframe jobs found.`);
    }

    // --- Task 11: Handle New VTO QA Jobs ---
    console.log(`[Watchdog-BG][${requestId}] === Task 11: Managing VTO QA Job Slot via RPC ===`);
    const { data: claimedQaJobId, error: qaRpcError } = await supabase.rpc('claim_next_vto_qa_job');
    if (qaRpcError) {
        console.error(`[Watchdog-BG][${requestId}] Task 11: RPC 'claim_next_vto_qa_job' failed:`, qaRpcError.message);
    } else if (claimedQaJobId) {
        console.log(`[Watchdog-BG][${requestId}] Task 11: Successfully claimed VTO QA job ${claimedQaJobId} via RPC. Invoking worker.`);
        const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-worker-vto-reporter', {
            body: { qa_job_id: claimedQaJobId }
        });
        if (invokeError) {
            console.error(`[Watchdog-BG][${requestId}] Task 11: CRITICAL! Failed to invoke worker for claimed QA job ${claimedQaJobId}:`, invokeError);
            await supabase.from('mira-agent-vto-qa-reports').update({
                status: 'pending',
                error_message: 'Watchdog failed to invoke worker.'
            }).eq('id', claimedQaJobId);
        } else {
            actionsTaken.push(`Started new VTO QA worker for job ${claimedQaJobId}.`);
        }
    } else {
        console.log(`[Watchdog-BG][${requestId}] Task 11: No pending VTO QA jobs found to claim.`);
    }
    console.log(`[Watchdog-BG][${requestId}] === Task 11: Finished ===`);

    // --- Task 12: Handle jobs with expanded masks, ready for step 2 ---
    const { data: readyForStep2Jobs, error: step2Error } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('id, metadata')
      .eq('status', 'mask_expanded');

    if (step2Error) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for jobs ready for step 2:`, step2Error.message);
    } else if (readyForStep2Jobs && readyForStep2Jobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${readyForStep2Jobs.length} job(s) with expanded masks. Triggering step 2 worker...`);
      const step2Promises = readyForStep2Jobs.map((job) => {
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
    const { data: pendingChunk, error: chunkError } = await supabase
      .from('mira-agent-vto-report-chunks')
      .select('id')
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();

    if (chunkError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for pending report chunks:`, chunkError.message);
    } else if (pendingChunk) {
      console.log(`[Watchdog-BG][${requestId}] Found pending report chunk ${pendingChunk.id}. Claiming and invoking worker...`);
      
      const { error: updateError } = await supabase
        .from('mira-agent-vto-report-chunks')
        .update({ status: 'processing' })
        .eq('id', pendingChunk.id);

      if (updateError) {
        console.error(`[Watchdog-BG][${requestId}] Failed to claim chunk ${pendingChunk.id}:`, updateError.message);
      } else {
        supabase.functions.invoke('MIRA-AGENT-analyzer-vto-report-chunk-worker', {
          body: { chunk_id: pendingChunk.id }
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
      const synthesizerPromises = readyPacks.map(pack => 
        supabase.functions.invoke('MIRA-AGENT-final-synthesizer-vto-report', {
          body: { pack_id: pack.pack_id }
        })
      );
      await Promise.allSettled(synthesizerPromises);
      actionsTaken.push(`Triggered final synthesis for ${readyPacks.length} VTO report packs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No VTO report packs are ready for final synthesis.`);
    }

    // --- Task 15: Handle Stalled Fixer Jobs ---
    const fixerThreshold = new Date(Date.now() - STALLED_FIXER_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledFixerJobs, error: fixerError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id, metadata')
      .in('status', ['awaiting_fix', 'fixing'])
      .lt('updated_at', fixerThreshold);

    if (fixerError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled fixer jobs:`, fixerError.message);
    } else if (stalledFixerJobs && stalledFixerJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledFixerJobs.length} stalled fixer job(s). Re-triggering orchestrator...`);
      const fixerPromises = stalledFixerJobs.map(async (job) => {
        const qaHistory = job.metadata?.qa_history;
        if (!qaHistory || qaHistory.length === 0) {
          console.error(`[Watchdog-BG][${requestId}] Cannot fix job ${job.id}: Missing QA history. Marking as permanently failed.`);
          await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'permanently_failed', error_message: 'Cannot be fixed: QA history is missing.' }).eq('id', job.id);
          return;
        }
        const lastReport = qaHistory[qaHistory.length - 1];
        return supabase.functions.invoke('MIRA-AGENT-fixer-orchestrator', {
          body: { job_id: job.id, qa_report_object: lastReport }
        });
      });
      await Promise.allSettled(fixerPromises);
      actionsTaken.push(`Re-triggered ${stalledFixerJobs.length} stalled fixer jobs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled fixer jobs found.`);
    }

    // --- Task 16: Handle Stalled QA Report Jobs ---
    const qaReportThreshold = new Date(Date.now() - STALLED_QA_REPORT_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledQaJobs, error: qaError } = await supabase
      .from('mira-agent-vto-qa-reports')
      .select('id')
      .eq('status', 'processing')
      .lt('updated_at', qaReportThreshold);

    if (qaError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled QA jobs:`, qaError.message);
    } else if (stalledQaJobs && stalledQaJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledQaJobs.length} stalled QA job(s). Resetting to 'pending'.`);
      const jobIdsToReset = stalledQaJobs.map(j => j.id);
      await supabase.from('mira-agent-vto-qa-reports').update({ status: 'pending', error_message: 'Reset by watchdog.' }).in('id', jobIdsToReset);
      actionsTaken.push(`Reset ${stalledQaJobs.length} stalled QA jobs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled QA jobs found.`);
    }

    // --- Task 17: Handle Stalled Report Chunk Jobs ---
    const chunkWorkerThreshold = new Date(Date.now() - STALLED_CHUNK_WORKER_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledChunkJobs, error: stalledChunkError } = await supabase
      .from('mira-agent-vto-report-chunks')
      .select('id')
      .eq('status', 'processing')
      .lt('updated_at', chunkWorkerThreshold);

    if (stalledChunkError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled chunk jobs:`, stalledChunkError.message);
    } else if (stalledChunkJobs && stalledChunkJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledChunkJobs.length} stalled chunk job(s). Resetting to 'pending'.`);
      const chunkIdsToReset = stalledChunkJobs.map(j => j.id);
      await supabase.from('mira-agent-vto-report-chunks').update({ status: 'pending', error_message: 'Reset by watchdog.' }).in('id', chunkIdsToReset);
      actionsTaken.push(`Reset ${stalledChunkJobs.length} stalled chunk jobs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled chunk jobs found.`);
    }

    // --- Task 18: Handle VTO Jobs Awaiting BitStudio Fallback ---
    const { data: awaitingFallbackJobs, error: fallbackError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id, metadata')
      .eq('status', 'awaiting_bitstudio_fallback');

    if (fallbackError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for jobs awaiting fallback:`, fallbackError.message);
    } else if (awaitingFallbackJobs && awaitingFallbackJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${awaitingFallbackJobs.length} job(s) awaiting BitStudio fallback. Checking status...`);
      const fallbackCheckPromises = awaitingFallbackJobs.map(async (vtoJob) => {
        const bitstudioJobId = vtoJob.metadata?.delegated_bitstudio_job_id;
        if (!bitstudioJobId) return;

        const { data: bitstudioJob, error: bitstudioFetchError } = await supabase
          .from('mira-agent-bitstudio-jobs')
          .select('status, final_image_url, error_message')
          .eq('id', bitstudioJobId)
          .single();

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

    // --- Task 19: Handle Google VTO Permanent Failures & Escalate ---
    const { data: failedPrimaryJobs, error: failedPrimaryError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id, user_id, source_person_image_url, source_garment_image_url, metadata')
      .eq('status', 'permanently_failed_primary')
      .not('source_person_image_url', 'is', null)
      .not('source_garment_image_url', 'is', null);

    if (failedPrimaryError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for permanently failed primary jobs:`, failedPrimaryError.message);
    } else if (failedPrimaryJobs && failedPrimaryJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${failedPrimaryJobs.length} job(s) that failed the primary engine. Escalating to BitStudio fallback...`);
      
      failedPrimaryJobs.forEach(job => {
        console.warn(`[Watchdog-BG][${requestId}] WARNING: Google VTO job ${job.id} has permanently failed. Escalating to BitStudio fallback engine.`);
      });

      const escalationPromises = failedPrimaryJobs.map(async (job) => {
        try {
          await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'awaiting_bitstudio_fallback',
            metadata: { ...job.metadata, engine: 'bitstudio_fallback' }
          }).eq('id', job.id);

          const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
            body: {
              existing_job_id: job.id,
              mode: 'base',
              user_id: job.user_id,
              person_image_url: job.source_person_image_url,
              garment_image_url: job.source_garment_image_url,
              metadata: job.metadata
            }
          });
          if (proxyError) throw proxyError;
          
          await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: { ...job.metadata, delegated_bitstudio_job_id: proxyData.jobIds[0] }
          }).eq('id', job.id);

          console.log(`[Watchdog-BG][${requestId}] Successfully escalated job ${job.id} to BitStudio job ${proxyData.jobIds[0]}.`);
        } catch (escalationError) {
          console.error(`[Watchdog-BG][${requestId}] Failed to escalate job ${job.id}:`, escalationError.message);
          await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'failed',
            error_message: `Escalation to fallback engine failed: ${escalationError.message}`
          }).eq('id', job.id);
        }
      });
      await Promise.allSettled(escalationPromises);
      actionsTaken.push(`Escalated ${failedPrimaryJobs.length} failed primary jobs to the BitStudio fallback.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No jobs awaiting fallback escalation.`);
    }

    const finalMessage = actionsTaken.length > 0 ? actionsTaken.join(' ') : "No actions required. All jobs are running normally.";
    console.log(`[Watchdog-BG][${requestId}] Check complete. ${finalMessage}`);
    
    return new Response(JSON.stringify({ message: finalMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error(`[Watchdog-BG][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});