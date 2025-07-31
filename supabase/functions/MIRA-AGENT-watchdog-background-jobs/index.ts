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
    console.log(`[Watchdog-BG][${requestId}] Triggering Batch Inpaint Worker...`);
    supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', { body: {} }).catch(console.error);
    actionsTaken.push(`Triggered batch inpaint worker.`);

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

    // --- Task 7: Manage Single Google VTO Pack Job Slot ---
    const { data: claimedVtoJobId, error: vtoRpcError } = await supabase.rpc('claim_next_google_vto_job');
    if (vtoRpcError) {
      console.error(`[Watchdog-BG][${requestId}] RPC 'claim_next_google_vto_job' failed:`, vtoRpcError.message);
    } else if (claimedVtoJobId) {
      console.log(`[Watchdog-BG][${requestId}] Claimed job ${claimedVtoJobId} via RPC. Invoking worker.`);
      supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: claimedVtoJobId } }).catch(console.error);
      actionsTaken.push(`Started new Google VTO worker for job ${claimedVtoJobId}.`);
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

    // --- Task 15: Stalled Fixer Jobs ---
    await recoverStalledJobs('mira-agent-bitstudio-jobs', ['awaiting_fix', 'fixing'], STALLED_FIXER_THRESHOLD_SECONDS, 'MIRA-AGENT-fixer-orchestrator', 'id', 'job_id');

    // --- Task 21: Stalled Stylist Choice Jobs ---
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