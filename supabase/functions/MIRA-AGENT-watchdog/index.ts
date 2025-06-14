import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// A job is considered stalled if it's been in 'processing' for more than 2 minutes
const STALLED_THRESHOLD_MINUTES = 2;

serve(async (req) => {
  console.log("MIRA-AGENT-watchdog: Function invoked.");

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("MIRA-AGENT-watchdog: Creating Supabase client.");
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    console.log(`MIRA-AGENT-watchdog: Checking for jobs stalled since ${threshold}`);

    console.log("MIRA-AGENT-watchdog: Querying for stalled jobs...");
    const { data: stalledJobs, error: queryError } = await supabase
      .from('mira-agent-jobs')
      .select('id')
      .eq('status', 'processing')
      .lt('updated_at', threshold);

    if (queryError) {
      console.error("MIRA-AGENT-watchdog: Error querying for stalled jobs:", queryError);
      throw new Error(`Failed to query for stalled jobs: ${queryError.message}`);
    }

    if (!stalledJobs || stalledJobs.length === 0) {
      const message = "MIRA-AGENT-watchdog: No stalled jobs found. Check complete.";
      console.log(message);
      return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`MIRA-AGENT-watchdog: Found ${stalledJobs.length} stalled job(s). Re-triggering now...`);

    const triggerPromises = stalledJobs.map(job => {
      console.log(`MIRA-AGENT-watchdog: Re-triggering master-worker for stalled job ID: ${job.id}`);
      return supabase.functions.invoke('MIRA-AGENT-master-worker', { body: { job_id: job.id } });
    });

    await Promise.allSettled(triggerPromises);

    const successMessage = `MIRA-AGENT-watchdog: Successfully re-triggered ${stalledJobs.length} stalled job(s).`;
    console.log(successMessage);
    return new Response(JSON.stringify({ message: successMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("MIRA-AGENT-watchdog: Unhandled error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});