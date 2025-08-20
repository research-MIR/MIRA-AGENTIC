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

const RETRY_DELAYS = [1000, 3000, 6000]; // 1s, 3s, 6s

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
        const pipeline = Deno.env.get('FAL_PIPELINE_ID') || 'comfy/research-MIR/test';
        const status = await fal.queue.status(pipeline, { requestId: job.fal_request_id, logs: false });

        if (status.status === 'COMPLETED') {
          console.log(`${logPrefix}[${job.id}] Job complete. Fetching result with retries...`);
          let finalResult = null;
          let lastResultError = null;

          for (let i = 0; i < RETRY_DELAYS.length + 1; i++) {
            try {
              const result: any = await fal.queue.result(pipeline, { requestId: job.fal_request_id });
              const imageUrl = result?.data?.outputs?.['283']?.images?.[0]?.url;

              if (imageUrl) {
                finalResult = result;
                lastResultError = null;
                break;
              }
              lastResultError = new Error("Result fetched but final image URL was not found in the payload.");
            } catch (e) {
              lastResultError = e;
            }
            if (i < RETRY_DELAYS.length) {
              console.log(`${logPrefix}[${job.id}] Result not ready yet. Retrying in ${RETRY_DELAYS[i]}ms...`);
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[i]));
            }
          }

          if (lastResultError || !finalResult) {
            throw lastResultError || new Error("Failed to fetch valid result after all retries.");
          }
          
          console.log(`${logPrefix}[${job.id}] Successfully fetched result. Raw data:`, JSON.stringify(finalResult, null, 2));
          await supabase.from('fal_comfyui_jobs').update({ status: 'complete', final_result: finalResult }).eq('id', job.id);

        } else if (status.status === 'ERROR') {
          console.error(`${logPrefix}[${job.id}] Job failed. Error:`, status.error);
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