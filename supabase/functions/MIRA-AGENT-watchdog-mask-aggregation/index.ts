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
  console.log("[MaskWatchdog] Function invoked by schedule.");
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    console.log(`[MaskWatchdog] Checking for jobs stalled since ${threshold}`);

    const { data: stalledJobs, error: queryError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .select('id, status')
      .in('status', ['aggregating', 'compositing'])
      .lt('updated_at', threshold);

    if (queryError) throw queryError;

    if (!stalledJobs || stalledJobs.length === 0) {
      console.log("[MaskWatchdog] No stalled jobs found. Check complete.");
      return new Response(JSON.stringify({ message: "No stalled jobs found." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`[MaskWatchdog] Found ${stalledJobs.length} stalled job(s). Marking as failed...`);

    const updates = stalledJobs.map(job => 
      supabase
        .from('mira-agent-mask-aggregation-jobs')
        .update({ status: 'failed', error_message: `Job timed out in '${job.status}' state.` })
        .eq('id', job.id)
    );

    await Promise.all(updates);

    const successMessage = `[MaskWatchdog] Successfully marked ${stalledJobs.length} stalled job(s) as failed.`;
    console.log(successMessage);
    return new Response(JSON.stringify({ message: successMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[MaskWatchdog] Unhandled error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});