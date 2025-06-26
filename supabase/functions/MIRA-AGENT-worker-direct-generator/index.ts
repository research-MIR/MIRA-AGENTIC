import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  const { job_id } = await req.json();
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });
  }

  console.log(`[DirectGenWorker][${job_id}] Invoked.`);
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-jobs')
      .select('context, user_id')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    const context = job.context;
    const modelId = context.model_id;

    if (!modelId) {
        throw new Error("No model_id found in job context.");
    }
    console.log(`[DirectGenWorker][${job_id}] Found model_id in context: ${modelId}`);

    const { data: modelDetails, error: modelError } = await supabase
        .from('mira-agent-models')
        .select('provider')
        .eq('model_id_string', modelId)
        .single();

    if (modelError) throw new Error(`Could not find details for model ${modelId}: ${modelError.message}`);
    
    const provider = modelDetails.provider.toLowerCase().replace(/[^a-z0-9.-]/g, '');
    
    console.log(`[DirectGenWorker][${job_id}] Sanitized provider string: "${provider}"`);
    
    let toolToInvoke = '';
    let payload: { [key: string]: any } = {
        prompt: context.final_prompt_used || context.prompt,
        negative_prompt: context.negative_prompt,
        number_of_images: context.number_of_images,
        seed: context.seed,
        model_id: modelId,
        invoker_user_id: job.user_id,
    };

    if (provider === 'google') {
        toolToInvoke = 'MIRA-AGENT-tool-generate-image-google';
        payload.size = context.size;
    } else if (provider === 'fal.ai') {
        toolToInvoke = 'MIRA-AGENT-tool-generate-image-fal-seedream';
        // The seedream tool expects a size string like '1024x1024' and will map it internally.
        payload.size = context.size;
    } else {
        throw new Error(`Unsupported provider '${provider}' for direct generation.`);
    }

    console.log(`[DirectGenWorker][${job_id}] Routing to tool: ${toolToInvoke} for provider: ${provider} with payload:`, payload);
    
    const { data: generationResult, error: generationError } = await supabase.functions.invoke(toolToInvoke, {
      body: payload
    });

    if (generationError) throw generationError;

    console.log(`[DirectGenWorker][${job_id}] Generation successful. Updating job status to 'complete'.`);
    await supabase.from('mira-agent-jobs').update({
      status: 'complete',
      final_result: generationResult,
      error_message: null
    }).eq('id', job_id);

    return new Response(JSON.stringify({ success: true, result: generationResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error(`[DirectGenWorker][${job_id}] Error during processing:`, error);
    await supabase.from('mira-agent-jobs').update({
      status: 'failed',
      error_message: error.message
    }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});