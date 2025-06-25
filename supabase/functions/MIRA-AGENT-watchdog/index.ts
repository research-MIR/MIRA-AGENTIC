import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALLED_THRESHOLD_MINUTES = 1; // A job is stalled if not updated for 1 minute

serve(async (req) => {
  console.log("Main Agent Watchdog: Function invoked.");

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    console.log(`Main Agent Watchdog: Checking for jobs stalled since ${threshold}`);

    const { data: stalledJobs, error } = await supabase
      .from('mira-agent-jobs')
      .select('id, status')
      .eq('status', 'processing')
      .lt('updated_at', threshold);

    if (error) {
      console.error("Main Agent Watchdog: Error querying for stalled jobs:", error.message);
      throw error;
    }

    if (!stalledJobs || stalledJobs.length === 0) {
      const message = "Main Agent Watchdog: No stalled jobs found. Check complete.";
      console.log(message);
      return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`Main Agent Watchdog: Found ${stalledJobs.length} stalled job(s). Re-triggering master workers...`);

    const triggerPromises = stalledJobs.map(job => {
      console.log(`Main Agent Watchdog: Re-triggering master-worker for stalled job ID: ${job.id}`);
      return supabase.functions.invoke('MIRA-AGENT-master-worker', {
        body: { job_id: job.id }
      });
    });

    await Promise.allSettled(triggerPromises);

    const successMessage = `Main Agent Watchdog: Successfully re-triggered ${stalledJobs.length} stalled job(s).`;
    console.log(successMessage);
    return new Response(JSON.stringify({ message: successMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Main Agent Watchdog: Unhandled error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});