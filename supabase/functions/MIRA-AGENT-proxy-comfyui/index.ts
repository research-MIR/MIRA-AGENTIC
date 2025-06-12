import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `queue-proxy-${Date.now()}`;
  console.log(`[QueueProxy][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const body = await req.json();
    console.log(`[QueueProxy][${requestId}] Received request body.`);
    
    const { comfyui_address, invoker_user_id, prompt_workflow } = body;

    if (!prompt_workflow) {
        throw new Error("Request body must contain 'prompt_workflow'.");
    }
    if (!comfyui_address) throw new Error("Missing required parameter: comfyui_address");
    if (!invoker_user_id) throw new Error("Missing required parameter: invoker_user_id");
    
    console.log(`[QueueProxy][${requestId}] All parameters validated.`);

    const sanitizedAddress = comfyui_address.replace(/\/+$/, "");
    const queueUrl = `${sanitizedAddress}/prompt`;
    
    const payload = { 
      prompt: prompt_workflow 
    };
    console.log(`[QueueProxy][${requestId}] Sending prompt to: ${queueUrl}`);

    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify(payload),
    });

    console.log(`[QueueProxy][${requestId}] Received response from ComfyUI with status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[QueueProxy][${requestId}] ComfyUI prompt error:`, errorText);
      throw new Error(`ComfyUI server responded with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (!data.prompt_id) {
        throw new Error("ComfyUI did not return a prompt_id.");
    }
    console.log(`[QueueProxy][${requestId}] ComfyUI returned prompt_id: ${data.prompt_id}`);

    const { data: newJob, error: insertError } = await supabase
        .from('mira-agent-comfyui-jobs')
        .insert({
            user_id: invoker_user_id,
            comfyui_address: sanitizedAddress,
            comfyui_prompt_id: data.prompt_id,
            status: 'queued'
        })
        .select('id')
        .single();

    if (insertError) throw insertError;
    console.log(`[QueueProxy][${requestId}] Created DB job with ID: ${newJob.id}`);

    console.log(`[QueueProxy][${requestId}] Invoking poller for job ${newJob.id}...`);
    supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id: newJob.id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[QueueProxy][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});