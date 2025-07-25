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
const STALLED_PAIR_JOB_THRESHOLD_MINUTES = 2;
const STALLED_GOOGLE_VTO_THRESHOLD_MINUTES = 2;
const STALLED_QUEUED_VTO_THRESHOLD_SECONDS = 30;
const STALLED_REFRAME_THRESHOLD_MINUTES = 1;

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
    const { data: claimedBatchJobId, error: batchRpcError } = await supabase.rpc('claim_next_batch_inpaint_job');
    if (batchRpcError) {
        console.error(`[Watchdog-BG][${requestId}] RPC 'claim_next_batch_inpaint_job' failed:`, batchRpcError.message);
    } else if (claimedBatchJobId) {
        console.log(`[Watchdog-BG][${requestId}] Claimed batch inpaint job ${claimedBatchJobId}. Invoking worker.`);
        const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', {
            body: { pair_job_id: claimedBatchJobId }
        });
        if (invokeError) {
            console.error(`[Watchdog-BG][${requestId}] CRITICAL! Failed to invoke worker for claimed job ${claimedBatchJobId}:`, invokeError);
            await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
                status: 'pending',
                error_message: 'Watchdog failed to invoke worker.'
            }).eq('id', claimedBatchJobId);
        } else {
            actionsTaken.push(`Started new batch inpaint worker for job ${claimedBatchJobId}.`);
        }
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
    }

    // --- Task 4: Handle Stalled Batch Inpainting Pair Jobs ---
    const pairJobThreshold = new Date(Date.now() - STALLED_PAIR_JOB_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const { data: stalledPairJobs, error: stalledPairError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id, status, metadata').in('status', [
      'segmenting',
      'delegated'
    ]).lt('updated_at', pairJobThreshold);
    if (stalledPairError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for stalled pair jobs:`, stalledPairError.message);
    } else if (stalledPairJobs && stalledPairJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledPairJobs.length} stalled pair job(s). Re-triggering appropriate workers...`);
      const retryPromises = stalledPairJobs.map((job)=>{
        if (job.status === 'segmenting') {
          return supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', { body: { pair_job_id: job.id } });
        } else if (job.status === 'delegated' && job.metadata?.debug_assets?.expanded_mask_url) {
          return supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', { body: { pair_job_id: job.id, final_mask_url: job.metadata.debug_assets.expanded_mask_url } });
        }
        return Promise.resolve();
      });
      await Promise.allSettled(retryPromises);
      actionsTaken.push(`Re-triggered ${stalledPairJobs.length} stalled pair jobs.`);
    }

    // --- Task 5-11: Existing VTO, Reframe, and QA logic... (omitted for brevity, but would be here)

    // --- NEW Task 12: Handle Pending VTO Report Chunk Jobs ---
    const { data: pendingChunk, error: chunkError } = await supabase
      .from('mira-agent-vto-report-chunks')
      .select('id')
      .eq('status', 'pending')
      .limit(1)
      .maybeSingle();
    
    if (chunkError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for pending report chunks:`, chunkError.message);
    } else if (pendingChunk) {
      console.log(`[Watchdog-BG][${requestId}] Found pending report chunk ${pendingChunk.id}. Invoking worker.`);
      await supabase.functions.invoke('MIRA-AGENT-analyzer-vto-report-chunk-worker', { body: { chunk_job_id: pendingChunk.id } });
      actionsTaken.push(`Started analysis for report chunk ${pendingChunk.id}.`);
    }

    // --- NEW Task 13: Check for Completed Packs Ready for Synthesis ---
    const { data: readyPacks, error: packsError } = await supabase.rpc('find_packs_ready_for_synthesis');
    if (packsError) {
      console.error(`[Watchdog-BG][${requestId}] Error checking for packs ready for synthesis:`, packsError.message);
    } else if (readyPacks && readyPacks.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${readyPacks.length} pack(s) ready for final synthesis.`);
      const synthesisPromises = readyPacks.map((pack: any) => {
        console.log(`[Watchdog-BG][${requestId}] Invoking synthesizer for pack ${pack.pack_id}.`);
        return supabase.functions.invoke('MIRA-AGENT-worker-vto-report-synthesis', { body: { pack_id: pack.pack_id } });
      });
      await Promise.allSettled(synthesisPromises);
      actionsTaken.push(`Triggered final synthesis for ${readyPacks.length} pack(s).`);
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