import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALLED_THRESHOLD_MINUTES = 5;

serve(async (req) => {
  console.log("BitStudio Watchdog: Function invoked.");

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    console.log(`BitStudio Watchdog: Checking for jobs stalled since ${threshold}`);

    const { data: stalledJobs, error: queryError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id')
      .in('status', ['queued', 'processing'])
      .lt('last_polled_at', threshold);

    if (queryError) {
      throw new Error(`Failed to query for stalled jobs: ${queryError.message}`);
    }

    if (!stalledJobs || stalledJobs.length === 0) {
      const message = "BitStudio Watchdog: No stalled jobs found. Check complete.";
      console.log(message);
      return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`BitStudio Watchdog: Found ${stalledJobs.length} stalled job(s). Re-triggering pollers now...`);

    const triggerPromises = stalledJobs.map(job => {
      console.log(`BitStudio Watchdog: Re-triggering poller for stalled job ID: ${job.id}`);
      return supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id: job.id } });
    });

    await Promise.allSettled(triggerPromises);

    const successMessage = `BitStudio Watchdog: Successfully re-triggered ${stalledJobs.length} stalled job(s).`;
    console.log(successMessage);
    return new Response(JSON.stringify({ message: successMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("BitStudio Watchdog: Unhandled error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});