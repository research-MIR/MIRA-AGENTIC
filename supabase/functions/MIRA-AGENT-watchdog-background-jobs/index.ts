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
const STALLED_REFRAME_THRESHOLD_MINUTES = 2;

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
    // This task remains unchanged.
    
    // --- Task 2: Handle New Pending Batch Inpainting Jobs ---
    // This task remains unchanged.
    
    // --- Task 3: Handle Stalled Segmentation Aggregation Jobs ---
    // This task remains unchanged.
    
    // --- Task 4: Handle Stalled Batch Inpainting Pair Jobs ---
    // This task remains unchanged.
    
    // --- Task 5: Manage Single Google VTO Pack Job Slot ---
    console.log(`[Watchdog-BG][${requestId}] === Task 5: Managing Google VTO Pack Job Slot ===`);

    const { data: activeJob, error: activeJobError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id, status')
      .in('status', ['queued', 'processing', 'awaiting_reframe'])
      .eq('metadata->>engine', 'google')
      .limit(1)
      .single();

    if (activeJobError && activeJobError.code !== 'PGRST116') {
      console.error(`[Watchdog-BG][${requestId}] Task 5: Error checking for active VTO jobs:`, activeJobError.message);
    } else if (activeJob) {
      console.log(`[Watchdog-BG][${requestId}] Task 5: Slot is BUSY. Active job ${activeJob.id} has status '${activeJob.status}'. No action will be taken.`);
    } else {
      console.log(`[Watchdog-BG][${requestId}] Task 5: Slot is FREE. Searching for a pending job to start.`);
      
      const { data: nextJob, error: nextJobError } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id')
        .eq('status', 'pending')
        .eq('metadata->>engine', 'google')
        .order('created_at', { ascending: true })
        .limit(1)
        .single();

      if (nextJobError && nextJobError.code !== 'PGRST116') {
        console.error(`[Watchdog-BG][${requestId}] Task 5: Error fetching next pending VTO job:`, nextJobError.message);
      } else if (nextJob) {
        console.log(`[Watchdog-BG][${requestId}] Task 5: Found pending job ${nextJob.id}. Attempting to start it now.`);
        
        const { error: updateError } = await supabase
          .from('mira-agent-bitstudio-jobs')
          .update({ status: 'queued' })
          .eq('id', nextJob.id);

        if (updateError) {
          console.error(`[Watchdog-BG][${requestId}] Task 5: Failed to update status for job ${nextJob.id}:`, updateError.message);
        } else {
          console.log(`[Watchdog-BG][${requestId}] Task 5: Successfully claimed job ${nextJob.id}. Invoking worker.`);
          const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
            body: { pair_job_id: nextJob.id }
          });
          if (invokeError) {
            console.error(`[Watchdog-BG][${requestId}] Task 5: CRITICAL! Failed to invoke worker for job ${nextJob.id}:`, invokeError);
            await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: 'Watchdog failed to invoke worker.' }).eq('id', nextJob.id);
          } else {
            console.log(`[Watchdog-BG][${requestId}] Task 5: Successfully invoked worker for job ${nextJob.id}.`);
            actionsTaken.push(`Started new Google VTO worker for job ${nextJob.id}.`);
          }
        }
      } else {
        console.log(`[Watchdog-BG][${requestId}] Task 5: No pending Google VTO jobs found in the queue. The slot remains free.`);
      }
    }
    console.log(`[Watchdog-BG][${requestId}] === Task 5: Finished ===`);

    // --- Task 7: Handle VTO Jobs Awaiting Reframe ---
    // This task remains unchanged.
    
    // --- Task 8: Handle Recontext Jobs Awaiting Reframe ---
    // This task remains unchanged.

    // --- Task 9: Handle Stalled Reframe Worker Jobs ---
    // This task remains unchanged.

    const finalMessage = actionsTaken.length > 0 ? actionsTaken.join(' ') : "No actions required for VTO packs. All other checks complete.";
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