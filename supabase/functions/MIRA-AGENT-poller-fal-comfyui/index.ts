import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const FAL_KEY = Deno.env.get('FAL_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  fal.config({ credentials: FAL_KEY! });
  const logPrefix = `[FalPoller]`;

  try {
    const { data: jobs, error: fetchError } = await supabase
      .from('fal_comfyui_jobs')
      .select('*')
      .in('status', ['queued', 'processing'])
      .limit(10);

    if (fetchError) throw fetchError;
    if (!jobs || jobs.length === 0) {
      console.log(`${logPrefix} No active jobs to poll.`);
      return new Response(JSON.stringify({ success: true, message: "No active jobs." }), { headers: corsHeaders });
    }

    console.log(`${logPrefix} Found ${jobs.length} active job(s) to check.`);

    const pollPromises = jobs.map(async (job) => {
      try {
        const status = await fal.queue.status("comfy/research-MIR/test", { requestId: job.fal_request_id, logs: false });

        if (status.status === 'COMPLETED') {
          console.log(`${logPrefix}[${job.id}] Job complete. Fetching result...`);
          const result = await fal.queue.result("comfy/research-MIR/test", { requestId: job.fal_request_id });
          await supabase.from('fal_comfyui_jobs').update({ status: 'complete', final_result: result }).eq('id', job.id);
        } else if (status.status === 'ERROR') {
          console.error(`${logPrefix}[${job.id}] Job failed. Error: ${status.error}`);
          await supabase.from('fal_comfyui_jobs').update({ status: 'failed', error_message: status.error?.toString() }).eq('id', job.id);
        } else {
          await supabase.from('fal_comfyui_jobs').update({ status: 'processing', last_polled_at: new Date().toISOString() }).eq('id', job.id);
        }
      } catch (error) {
        console.error(`${logPrefix}[${job.id}] Error polling job:`, error);
        await supabase.from('fal_comfyui_jobs').update({ status: 'failed', error_message: error.message }).eq('id', job.id);
      }
    });

    await Promise.allSettled(pollPromises);
    return new Response(JSON.stringify({ success: true, checked: jobs.length }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});