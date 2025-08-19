import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id } = await req.json();
    if (!job_id) {
      throw new Error("job_id is required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[RetryBaseModel][${job_id}]`;
    console.log(`${logPrefix} Tool invoked.`);

    // 1. Fetch the job to get current metadata
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .select('metadata')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;

    const currentRetryCount = job.metadata?.base_model_retry_count || 0;

    // 2. Update the job to reset its state, including clearing old poses
    const { error: updateError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .update({
        status: 'pending',
        base_generation_results: [],
        base_model_image_url: null,
        final_posed_images: [], // Clear old poses
        error_message: null,
        metadata: {
          ...job.metadata,
          base_model_retry_count: currentRetryCount + 1,
        }
      })
      .eq('id', job_id);

    if (updateError) throw updateError;
    console.log(`${logPrefix} Job state reset successfully.`);

    // 3. Asynchronously invoke the poller to restart the generation process
    supabase.functions.invoke('MIRA-AGENT-poller-model-generation', {
      body: { job_id: job_id }
    }).catch(console.error);
    console.log(`${logPrefix} Poller invoked to restart generation.`);

    return new Response(JSON.stringify({ success: true, message: "Base model generation has been successfully retried." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[RetryBaseModel] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});