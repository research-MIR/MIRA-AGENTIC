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
    const { user_id } = await req.json();
    if (!user_id) {
      throw new Error("User ID is required to cancel jobs.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const activeStatuses = ['processing', 'queued', 'awaiting_feedback', 'awaiting_refinement'];
    const cancellationReason = "Cancelled by user via dev tools.";

    // Cancel jobs in mira-agent-jobs
    const { count: agentJobsCount, error: agentJobsError } = await supabase
      .from('mira-agent-jobs')
      .update({ status: 'failed', error_message: cancellationReason })
      .eq('user_id', user_id)
      .in('status', activeStatuses);

    if (agentJobsError) {
      console.error("Error cancelling mira-agent-jobs:", agentJobsError);
      throw new Error(`Failed to cancel agent jobs: ${agentJobsError.message}`);
    }

    // Cancel jobs in mira-agent-comfyui-jobs
    const { count: comfyJobsCount, error: comfyJobsError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .update({ status: 'failed', error_message: cancellationReason })
      .eq('user_id', user_id)
      .in('status', ['queued', 'processing']);

    if (comfyJobsError) {
      console.error("Error cancelling mira-agent-comfyui-jobs:", comfyJobsError);
      throw new Error(`Failed to cancel ComfyUI jobs: ${comfyJobsError.message}`);
    }
    
    const totalCancelled = (agentJobsCount || 0) + (comfyJobsCount || 0);
    const message = `Successfully cancelled ${totalCancelled} active job(s).`;
    console.log(message);

    return new Response(JSON.stringify({ success: true, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[CancelAllJobs] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});