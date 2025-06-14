import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    // A job is considered stalled if it hasn't been polled in the last 55 seconds.
    // This gives the rapid polling loop plenty of time to update the timestamp.
    const threshold = new Date(Date.now() - 55 * 1000).toISOString();

    const { data: stalledJobs, error: queryError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('id, last_polled_at')
      .in('status', ['queued', 'processing'])
      .lt('last_polled_at', threshold);

    if (queryError) {
      throw new Error(`Failed to query for stalled jobs: ${queryError.message}`);
    }

    if (!stalledJobs || stalledJobs.length === 0) {
      const message = "ComfyUI Watchdog: No stalled jobs found. The rapid polling loops are healthy.";
      console.log(message);
      return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`ComfyUI Watchdog: Found ${stalledJobs.length} stalled job(s). Invoking poller to restart their loops...`);

    const triggerPromises = stalledJobs.map(job => {
      console.log(`ComfyUI Watchdog: Restarting poller for stalled job: ${job.id} (last polled at: ${job.last_polled_at})`);
      return supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id: job.id } });
    });

    await Promise.allSettled(triggerPromises);

    const successMessage = `ComfyUI Watchdog: Successfully restarted pollers for ${stalledJobs.length} job(s).`;
    return new Response(JSON.stringify({ message: successMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("ComfyUI Watchdog Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});