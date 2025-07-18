import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALLED_POLLER_THRESHOLD_SECONDS = 15;
const STALLED_AGGREGATION_THRESHOLD_SECONDS = 20;
const STALLED_PAIR_JOB_THRESHOLD_MINUTES = 2;
const STALLED_GOOGLE_VTO_THRESHOLD_MINUTES = 2;
const STALLED_QUEUED_VTO_THRESHOLD_SECONDS = 30; // New threshold for jobs that fail to start

serve(async (req)=>{
  const requestId = `watchdog-bg-${Date.now()}`;
  console.log(`[Watchdog-BG][${requestId}] Function invoked.`);
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    let actionsTaken = [];
    // --- Task 1: Handle Stalled BitStudio Pollers ---
    const pollerThreshold = new Date(Date.now() - STALLED_POLLER_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledJobs, error: stalledError } = await supabase.from('mira-agent-bitstudio-jobs').select('id').in('status', [
      'queued',
      'processing'
    ]).lt('last_polled_at', pollerThreshold);
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
    const { data: pendingPairs, error: pendingError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('id').eq('status', 'pending').limit(5);
    if (pendingError) {
      console.error(`[Watchdog-BG][${requestId}] Error querying for pending batch jobs:`, pendingError.message);
    } else if (pendingPairs && pendingPairs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${pendingPairs.length} new pending batch job(s). Triggering workers...`);
      const jobIdsToProcess = pendingPairs.map((p)=>p.id);
      await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
        status: 'processing'
      }).in('id', jobIdsToProcess);
      const workerPromises = jobIdsToProcess.map((id)=>supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', {
          body: {
            pair_job_id: id
          }
        }));
      await Promise.allSettled(workerPromises);
      actionsTaken.push(`Started ${jobIdsToProcess.length} new batch inpaint workers.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No new pending batch jobs found.`);
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
        }
        return Promise.resolve();
      });
      await Promise.allSettled(retryPromises);
      actionsTaken.push(`Re-triggered ${stalledPairJobs.length} stalled pair jobs.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled pair jobs found.`);
    }
    // --- Task 5: Handle Stalled 'processing' Google VTO Pack Jobs ---
    const googleVtoThreshold = new Date(Date.now() - STALLED_GOOGLE_VTO_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const { data: stalledGoogleVtoJobs, error: googleVtoError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id')
      .eq('metadata->>engine', 'google')
      .eq('status', 'processing')
      .lt('updated_at', googleVtoThreshold);

    if (googleVtoError) {
        console.error(`[Watchdog-BG][${requestId}] Error querying for stalled Google VTO jobs:`, googleVtoError.message);
    } else if (stalledGoogleVtoJobs && stalledGoogleVtoJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${stalledGoogleVtoJobs.length} stalled Google VTO job(s). Re-triggering workers...`);
        const workerPromises = stalledGoogleVtoJobs.map(job => 
            supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: job.id } })
        );
        await Promise.allSettled(workerPromises);
        actionsTaken.push(`Re-triggered ${stalledGoogleVtoJobs.length} stalled Google VTO workers.`);
    } else {
        console.log(`[Watchdog-BG][${requestId}] No stalled 'processing' Google VTO jobs found.`);
    }

    // --- Task 6: Handle Stalled 'queued' Google VTO Pack Jobs (NEW) ---
    const queuedVtoThreshold = new Date(Date.now() - STALLED_QUEUED_VTO_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: queuedGoogleVtoJobs, error: queuedVtoError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id')
      .eq('metadata->>engine', 'google')
      .eq('status', 'queued')
      .lt('updated_at', queuedVtoThreshold);

    if (queuedVtoError) {
        console.error(`[Watchdog-BG][${requestId}] Error querying for queued Google VTO jobs:`, queuedVtoError.message);
    } else if (queuedGoogleVtoJobs && queuedGoogleVtoJobs.length > 0) {
        console.log(`[Watchdog-BG][${requestId}] Found ${queuedGoogleVtoJobs.length} queued Google VTO job(s) that failed to start. Kicking them off...`);
        const jobIdsToStart = queuedGoogleVtoJobs.map(j => j.id);
        
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'processing' }).in('id', jobIdsToStart);

        const workerPromises = jobIdsToStart.map(jobId => 
            supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: jobId } })
        );
        await Promise.allSettled(workerPromises);
        actionsTaken.push(`Started ${queuedGoogleVtoJobs.length} stalled 'queued' Google VTO workers.`);
    } else {
        console.log(`[Watchdog-BG][${requestId}] No stalled 'queued' Google VTO jobs found.`);
    }

    const finalMessage = actionsTaken.length > 0 ? actionsTaken.join(' ') : "No actions required. All jobs are running normally.";
    console.log(`[Watchdog-BG][${requestId}] Check complete. ${finalMessage}`);
    return new Response(JSON.stringify({
      message: finalMessage
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(`[Watchdog-BG][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});