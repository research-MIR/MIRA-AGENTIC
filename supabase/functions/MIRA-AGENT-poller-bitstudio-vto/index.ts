import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_BASE_URL = 'https://api.bitstudio.ai';
const POLLING_INTERVAL_MS = 5000; // 5 seconds

serve(async (req) => {
  const { job_id } = await req.json();
  if (!job_id) return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: job, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    if (job.status === 'complete' || job.status === 'failed') {
        return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const statusResponse = await fetch(`${BITSTUDIO_BASE_URL}/images/${job.bitstudio_task_id}`, {
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` }
    });

    if (!statusResponse.ok) {
        const errorText = await statusResponse.text();
        throw new Error(`bitStudio status check failed: ${errorText}`);
    }

    const statusData = await statusResponse.json();

    if (statusData.status === 'completed') {
        await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'complete',
            final_image_url: statusData.path
        }).eq('id', job_id);
        return new Response(JSON.stringify({ success: true, status: 'complete' }), { headers: corsHeaders });
    } else if (statusData.status === 'failed') {
        await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'failed',
            error_message: 'bitStudio processing failed.'
        }).eq('id', job_id);
        return new Response(JSON.stringify({ success: true, status: 'failed' }), { headers: corsHeaders });
    } else {
        // Still pending or generating, poll again
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-bitstudio-vto', { body: { job_id } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: statusData.status }), { headers: corsHeaders });
    }

  } catch (error) {
    console.error(`[BitStudioPoller][${job_id}] Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});