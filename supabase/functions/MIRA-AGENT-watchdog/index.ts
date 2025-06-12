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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Calculate the timestamp for the stalled threshold
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_MINUTES * 60 * 1000).toISOString();

    // Find jobs that are 'processing' and haven't been updated recently
    const { data: stalledJobs, error: queryError } = await supabase
      .from('mira-agent-jobs')
      .select('id')
      .eq('status', 'processing')
      .lt('updated_at', threshold);

    if (queryError) {
      throw new Error(`Failed to query for stalled jobs: ${queryError.message}`);
    }

    if (!stalledJobs || stalledJobs.length === 0) {
      const message = "Watchdog check complete. No stalled jobs found.";
      console.log(message);
      return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`Watchdog found ${stalledJobs.length} stalled job(s). Re-triggering now...`);

    const triggerPromises = stalledJobs.map(job => {
      console.log(`Re-triggering master-worker for stalled job: ${job.id}`);
      return supabase.functions.invoke('MIRA-AGENT-master-worker', { body: { job_id: job.id } });
    });

    await Promise.allSettled(triggerPromises);

    const successMessage = `Successfully re-triggered ${stalledJobs.length} stalled job(s).`;
    return new Response(JSON.stringify({ message: successMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Watchdog Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});