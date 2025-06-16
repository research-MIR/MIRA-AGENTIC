import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `direct-generator-proxy-${Date.now()}`;
  console.log(`[DirectGeneratorProxy][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const {
      prompt,
      negative_prompt,
      number_of_images,
      seed,
      model_id,
      invoker_user_id,
      size,
      final_prompt_used
    } = await req.json();

    if (!invoker_user_id || !prompt || !model_id) {
      throw new Error("Missing required parameters: invoker_user_id, prompt, or model_id.");
    }

    const jobContext = {
        source: 'direct_generator',
        prompt,
        negative_prompt,
        number_of_images,
        seed,
        model_id,
        size,
        final_prompt_used
    };

    console.log(`[DirectGeneratorProxy][${requestId}] Creating job ticket in 'mira-agent-jobs'.`);
    
    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-jobs')
      .insert({
        user_id: invoker_user_id,
        original_prompt: `Direct: ${final_prompt_used?.slice(0, 40) || prompt.slice(0, 40)}...`,
        status: 'processing',
        context: jobContext
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    const jobId = newJob.id;
    console.log(`[DirectGeneratorProxy][${requestId}] Job ticket ${jobId} created. Invoking worker.`);

    // Asynchronously invoke the worker to start processing the job.
    // Don't await this, so the response to the client is immediate.
    supabase.functions.invoke('MIRA-AGENT-worker-direct-generator', {
      body: { job_id: jobId }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: jobId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error(`[DirectGeneratorProxy][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});