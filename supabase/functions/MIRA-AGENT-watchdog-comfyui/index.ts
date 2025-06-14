import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// A job is considered stalled if it's been polled more than 2 minutes ago
const STALLED_THRESHOLD_MINUTES = 2;

serve(async (req) => {
  console.log("ComfyUI Watchdog: Function invoked.");

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    console.log(`ComfyUI Watchdog: Checking for jobs stalled since ${threshold}`);

    const { data: stalledJobs, error: queryError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('id')
      .in('status', ['queued', 'processing'])
      .lt('last_polled_at', threshold);

    if (queryError) {
      throw new Error(`Failed to query for stalled ComfyUI jobs: ${queryError.message}`);
    }

    if (!stalledJobs || stalledJobs.length === 0) {
      const message = "ComfyUI Watchdog: No stalled jobs found. Check complete.";
      console.log(message);
      return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`ComfyUI Watchdog: Found ${stalledJobs.length} stalled job(s). Re-triggering poller now...`);

    const triggerPromises = stalledJobs.map(job => {
      console.log(`ComfyUI Watchdog: Re-triggering poller for stalled job: ${job.id}`);
      // We don't await this, just fire and forget
      supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id: job.id } });
      return job.id;
    });

    const triggeredIds = await Promise.all(triggerPromises);

    const successMessage = `ComfyUI Watchdog: Successfully re-triggered poller for ${triggeredIds.length} stalled job(s).`;
    console.log(successMessage);
    return new Response(JSON.stringify({ message: successMessage, triggered_job_ids: triggeredIds }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ComfyUI Watchdog] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});