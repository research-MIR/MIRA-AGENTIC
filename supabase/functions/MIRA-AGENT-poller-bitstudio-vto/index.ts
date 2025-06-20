import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const POLLING_INTERVAL_MS = 5000; // 5 seconds

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    if (!job.bitstudio_task_id) throw new Error("Job is missing BitStudio task ID.");

    const response = await fetch(`https://api.bitstudio.ai/images/${job.bitstudio_task_id}`, {
      headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY!}` }
    });

    if (!response.ok) throw new Error(`BitStudio API error: ${response.statusText}`);
    const imageData = await response.json();

    if (imageData.status === 'completed') {
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'complete',
        final_image_url: imageData.path
      }).eq('id', job_id);
    } else if (imageData.status === 'failed') {
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'failed',
        error_message: 'Image generation failed on BitStudio.'
      }).eq('id', job_id);
    } else {
      // Still pending or generating, schedule another poll
      await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'processing' }).eq('id', job_id);
      setTimeout(() => {
        supabase.functions.invoke('MIRA-AGENT-poller-bitstudio-vto', { body: { job_id } }).catch(console.error);
      }, POLLING_INTERVAL_MS);
    }

    return new Response(JSON.stringify({ success: true, status: imageData.status }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[BitStudioPoller][${job_id}] Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});