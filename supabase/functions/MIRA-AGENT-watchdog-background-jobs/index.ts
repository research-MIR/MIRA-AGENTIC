import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALLED_POLLER_THRESHOLD_SECONDS = 30;

serve(async (req) => {
  const requestId = `watchdog-bg-${Date.now()}`;
  console.log(`[Watchdog-BG][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    let actionsTaken = [];

    // --- Task 1: Handle Stalled BitStudio Pollers ---
    const pollerThreshold = new Date(Date.now() - STALLED_POLLER_THRESHOLD_SECONDS * 1000).toISOString();
    const { data: stalledJobs, error: stalledError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id')
      .in('status', ['queued', 'processing'])
      .lt('last_polled_at', pollerThreshold);

    if (stalledError) {
        console.error(`[Watchdog-BG][${requestId}] Error querying for stalled jobs:`, stalledError.message);
    } else if (stalledJobs && stalledJobs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${stalledJobs.length} stalled BitStudio job(s). Re-triggering pollers...`);
      const pollerPromises = stalledJobs.map(job => 
        supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id: job.id } })
      );
      await Promise.allSettled(pollerPromises);
      actionsTaken.push(`Re-triggered ${stalledJobs.length} stalled BitStudio pollers.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] No stalled BitStudio jobs found.`);
    }

    // --- Task 2: Handle New Pending Batch Inpainting Jobs ---
    const { data: pendingPairs, error: pendingError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('id')
      .eq('status', 'pending')
      .limit(5); // Process up to 5 new jobs per run to avoid overwhelming the system

    if (pendingError) {
        console.error(`[Watchdog-BG][${requestId}] Error querying for pending batch jobs:`, pendingError.message);
    } else if (pendingPairs && pendingPairs.length > 0) {
      console.log(`[Watchdog-BG][${requestId}] Found ${pendingPairs.length} new pending batch job(s). Triggering workers...`);
      
      const jobIdsToProcess = pendingPairs.map(p => p.id);
      
      // Lock the jobs to prevent them from being picked up again
      await supabase
        .from('mira-agent-batch-inpaint-pair-jobs')
        .update({ status: 'processing' })
        .in('id', jobIdsToProcess);

      const workerPromises = jobIdsToProcess.map(id => 
        supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', { body: { pair_job_id: id } })
      );
      await Promise.allSettled(workerPromises);
      actionsTaken.push(`Started ${jobIdsToProcess.length} new batch inpaint workers.`);
    } else {
        console.log(`[Watchdog-BG][${requestId}] No new pending batch jobs found.`);
    }

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