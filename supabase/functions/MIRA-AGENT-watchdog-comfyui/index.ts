import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// A job is considered stalled if it's been polled more than 1 minute ago
const STALLED_THRESHOLD_MINUTES = 1;

serve(async (req) => {
  console.log("ComfyUI Watchdog: Function invoked.");

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("ComfyUI Watchdog: Creating Supabase client.");
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    console.log(`ComfyUI Watchdog: Checking for jobs stalled since ${threshold}`);

    console.log("ComfyUI Watchdog: Querying for the single oldest stalled job...");
    const { data: oldestStalledJob, error: queryError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('id')
      .in('status', ['queued', 'processing'])
      .lt('last_polled_at', threshold)
      .order('created_at', { ascending: true }) // Find the oldest
      .limit(1) // Only get one
      .single(); // Expect a single result or null

    // 'PGRST116' means no rows were found, which is a normal outcome and not an error.
    if (queryError && queryError.code !== 'PGRST116') {
      console.error("ComfyUI Watchdog: Error querying for stalled job:", queryError);
      throw new Error(`Failed to query for stalled ComfyUI job: ${queryError.message}`);
    }

    if (!oldestStalledJob) {
      const message = "ComfyUI Watchdog: No stalled jobs found. Check complete.";
      console.log(message);
      return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`ComfyUI Watchdog: Found oldest stalled job ID: ${oldestStalledJob.id}. Re-triggering poller now...`);

    // Asynchronously invoke the poller for the single oldest job
    supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id: oldestStalledJob.id } }).catch(console.error);

    const successMessage = `ComfyUI Watchdog: Successfully re-triggered poller for oldest stalled job: ${oldestStalledJob.id}.`;
    console.log(successMessage);
    return new Response(JSON.stringify({ message: successMessage, triggered_job_id: oldestStalledJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("ComfyUI Watchdog: Unhandled error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});