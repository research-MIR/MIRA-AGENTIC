import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  const requestId = `orchestrator-poses-${Date.now()}`;
  console.log(`[Orchestrator-Poses][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { base_model_image_url, pose_prompts, user_id } = await req.json();
    if (!base_model_image_url || !pose_prompts || !Array.isArray(pose_prompts) || !user_id) {
      throw new Error("base_model_image_url, pose_prompts array, and user_id are required.");
    }
    console.log(`[Orchestrator-Poses][${requestId}] Received ${pose_prompts.length} poses for user ${user_id}.`);

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    console.log(`[Orchestrator-Poses][${requestId}] Creating new job in 'mira-agent-model-generation-jobs'...`);
    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .insert({
        user_id,
        base_model_image_url,
        pose_prompts,
        status: 'pending',
        last_polled_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    const newJobId = newJob.id;
    console.log(`[Orchestrator-Poses][${requestId}] Job ${newJobId} created successfully.`);

    console.log(`[Orchestrator-Poses][${requestId}] Asynchronously invoking poller for job ${newJobId}.`);
    supabase.functions.invoke('MIRA-AGENT-poller-model-generation', {
      body: { job_id: newJobId }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Orchestrator-Poses][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});