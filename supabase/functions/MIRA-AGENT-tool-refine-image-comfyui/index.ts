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

  try {
    const { image_url, prompt, upscale_factor, main_agent_job_id, invoker_user_id } = await req.json();
    if (!image_url || !prompt || !upscale_factor || !main_agent_job_id || !invoker_user_id) {
      throw new Error("Missing required parameters: image_url, prompt, upscale_factor, main_agent_job_id, invoker_user_id.");
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Call the proxy to queue the ComfyUI job
    const { data, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
      body: {
        prompt_text: prompt,
        image_filename: image_url, // The proxy can handle URLs
        invoker_user_id: invoker_user_id,
        upscale_factor: upscale_factor,
        main_agent_job_id: main_agent_job_id,
        original_prompt_for_gallery: `Agent Refined: ${prompt.slice(0, 40)}...`
      }
    });

    if (error) throw error;

    const comfyJobId = data.jobId;
    console.log(`[RefineTool][${main_agent_job_id}] Successfully queued ComfyUI job ${comfyJobId}.`);

    // The tool's job is done. It just needs to return a simple object.
    // The master worker will handle pausing the main job.
    return new Response(JSON.stringify({ success: true, message: `Successfully queued refinement job ${comfyJobId}.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[RefineTool] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});