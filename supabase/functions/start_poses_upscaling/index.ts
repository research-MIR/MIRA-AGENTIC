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
    const { p_job_id, p_pose_urls, p_upscale_factor } = await req.json();
    if (!p_job_id || !p_pose_urls || !Array.isArray(p_pose_urls)) {
      throw new Error("job_id and an array of pose_urls are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .select('final_posed_images')
      .eq('id', p_job_id)
      .single();

    if (fetchError) throw fetchError;
    if (!job) throw new Error("Job not found.");

    const updatedPoses = (job.final_posed_images || []).map((pose: any) => {
      if (p_pose_urls.includes(pose.final_url)) {
        return { ...pose, upscale_status: 'pending', upscale_factor: p_upscale_factor || 1.5 };
      }
      return pose;
    });

    const { error: updateError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .update({
        status: 'upscaling_poses',
        final_posed_images: updatedPoses
      })
      .eq('id', p_job_id);

    if (updateError) throw updateError;

    // Asynchronously invoke the poller to start the process immediately
    supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: p_job_id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[StartPosesUpscaling] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});