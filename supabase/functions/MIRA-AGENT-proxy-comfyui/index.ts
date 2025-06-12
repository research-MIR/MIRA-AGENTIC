import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `queue-proxy-${Date.now()}`;
  console.log(`[QueueProxy][${requestId}] Function invoked.`);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { comfyui_address, prompt_workflow, invoker_user_id } = await req.json();
    if (!comfyui_address || !prompt_workflow || !invoker_user_id) {
      throw new Error("Missing 'comfyui_address', 'prompt_workflow', or 'invoker_user_id'.");
    }
    console.log(`[QueueProxy][${requestId}] Parsed request body.`);

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
      const errorJson = await response.json();
      let readableError = `ComfyUI server responded with status ${response.status}.`;
      if (errorJson.node_errors) {
        readableError += " Validation errors: ";
        for (const node in errorJson.node_errors) {
          const errorDetails = errorJson.node_errors[node].errors[0];
          readableError += `[Node ${node} (${errorDetails.type})]: ${errorDetails.details}. `;
        }
      } else {
        readableError += ` Details: ${JSON.stringify(errorJson)}`;
      }
      console.error(`[QueueProxy][${requestId}] ComfyUI prompt error:`, readableError);
      throw new Error(readableError);
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

    // Asynchronously trigger the poller to start watching the job
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