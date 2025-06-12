import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { comfyui_address, prompt_workflow, invoker_user_id } = await req.json();
    if (!comfyui_address || !prompt_workflow || !invoker_user_id) {
      throw new Error("Missing 'comfyui_address', 'prompt_workflow', or 'invoker_user_id'.");
    }

    const sanitizedAddress = comfyui_address.replace(/\/+$/, "");
    
    const payload = { 
      prompt: prompt_workflow 
    };

    const response = await fetch(`${sanitizedAddress}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify(payload),
    });

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
      throw new Error(readableError);
    }

    const data = await response.json();
    if (!data.prompt_id) {
        throw new Error("ComfyUI did not return a prompt_id.");
    }

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

    // Asynchronously trigger the poller to start watching the job
    supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id: newJob.id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ComfyUI Proxy Error]:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});