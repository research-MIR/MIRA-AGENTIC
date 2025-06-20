import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';
const POLLING_INTERVAL_MS = 3000; // 3 seconds

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[BitStudioPoller][${job_id}] Invoked to check status.`);

  try {
    // HEARTBEAT: Mark the job as being polled right now to prevent watchdog conflicts
    await supabase.from('mira-agent-bitstudio-jobs').update({ last_polled_at: new Date().toISOString() }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    
    if (job.status === 'complete' || job.status === 'failed') {
        console.log(`[BitStudioPoller][${job_id}] Job already resolved with status '${job.status}'. Halting check.`);
        return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const statusResponse = await fetch(`${BITSTUDIO_API_BASE}/images/${job.bitstudio_task_id}`, {
      headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` }
    });

    if (!statusResponse.ok) throw new Error(`BitStudio status check failed: ${await statusResponse.text()}`);
    const statusData = await statusResponse.json();

    if (statusData.status === 'completed') {
      console.log(`[BitStudioPoller][${job_id}] Status is 'completed'. Updating job and finalizing.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'complete',
        final_image_url: statusData.path,
      }).eq('id', job_id);
    } else if (statusData.status === 'failed') {
      console.error(`[BitStudioPoller][${job_id}] Status is 'failed'. Updating job with error.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'failed',
        error_message: 'BitStudio processing failed.',
      }).eq('id', job_id);
    } else {
      console.log(`[BitStudioPoller][${job_id}] Status is '${statusData.status}'. Re-polling in ${POLLING_INTERVAL_MS}ms.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'processing' }).eq('id', job_id);
      setTimeout(() => {
        supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id } }).catch(console.error);
      }, POLLING_INTERVAL_MS);
    }

    return new Response(JSON.stringify({ success: true, status: statusData.status }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[BitStudioPoller][${job_id}] Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});