import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[ModelGenPoller][${job_id}] Poller invoked.`);

  try {
    await supabase.from('mira-agent-model-generation-jobs').update({ last_polled_at: new Date().toISOString(), status: 'generating_poses' }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    if (job.status === 'complete' || job.status === 'failed') {
      console.log(`[ModelGenPoller][${job_id}] Job already resolved. Halting.`);
      return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const finalResults = [];
    for (const [index, pose] of job.pose_prompts.entries()) {
      console.log(`[ModelGenPoller][${job_id}] Processing pose ${index + 1}/${job.pose_prompts.length}: type=${pose.type}`);
      
      const payload = {
        base_model_url: job.base_model_image_url,
        pose_prompt: pose.type === 'text' ? pose.value : null,
        pose_image_url: pose.type === 'image' ? pose.value : null,
      };

      const { data: result, error: mockError } = await supabase.functions.invoke('MIRA-AGENT-mock-comfyui-pose-generator', {
        body: payload
      });

      if (mockError) throw new Error(`Mock generator failed for pose ${index + 1}: ${mockError.message}`);
      
      finalResults.push({
        pose_prompt: pose.value,
        pose_type: pose.type,
        generated_url: result.output_image_url
      });
    }

    console.log(`[ModelGenPoller][${job_id}] All poses processed. Finalizing job.`);
    await supabase.from('mira-agent-model-generation-jobs')
      .update({ status: 'complete', final_posed_images: finalResults })
      .eq('id', job_id);

    return new Response(JSON.stringify({ success: true, finalResults }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[ModelGenPoller][${job_id}] Error:`, error);
    await supabase.from('mira-agent-model-generation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});