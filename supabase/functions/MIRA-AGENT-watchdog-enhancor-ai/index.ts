import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALLED_THRESHOLD_MINUTES = 10; // A job is stalled if not updated for 10 minutes

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const logPrefix = `[EnhancorAI-Watchdog]`;
  console.log(`${logPrefix} Function invoked by cron job.`);

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    
    console.log(`${logPrefix} Checking for jobs stalled since ${threshold}`);

    const { data: stalledJobs, error } = await supabase
      .from('enhancor_ai_jobs')
      .select('id')
      .eq('status', 'processing')
      .lt('updated_at', threshold);

    if (error) {
      console.error(`${logPrefix} Error querying for stalled jobs:`, error.message);
      throw error;
    }

    if (!stalledJobs || stalledJobs.length === 0) {
      const message = `${logPrefix} No stalled jobs found. Check complete.`;
      console.log(message);
      return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`${logPrefix} Found ${stalledJobs.length} stalled job(s). Marking them as failed.`);

    const jobIdsToFail = stalledJobs.map(job => job.id);
    const errorMessage = `Job timed out after ${STALLED_THRESHOLD_MINUTES} minutes. The webhook from EnhancorAI was not received.`;

    const { count, error: updateError } = await supabase
      .from('enhancor_ai_jobs')
      .update({ status: 'failed', error_message: errorMessage })
      .in('id', jobIdsToFail);

    if (updateError) {
        console.error(`${logPrefix} Error updating stalled jobs:`, updateError.message);
        throw updateError;
    }

    const successMessage = `${logPrefix} Successfully marked ${count || 0} stalled job(s) as failed.`;
    console.log(successMessage);
    return new Response(JSON.stringify({ message: successMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});