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
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const cancellationReason = "Cancelled by admin dev tool.";

    // Find active parent jobs
    const { data: activeParentJobs, error: fetchError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .select('id')
      .in('status', ['tiling', 'generating', 'compositing', 'queued_for_generation']);

    if (fetchError) throw fetchError;

    if (!activeParentJobs || activeParentJobs.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No active tiled upscale jobs found to cancel." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const parentJobIds = activeParentJobs.map(j => j.id);

    // Cancel child tiles first
    const { count: tilesCount, error: tilesError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ status: 'failed', error_message: cancellationReason })
      .in('parent_job_id', parentJobIds)
      .in('status', ['pending_analysis', 'analyzing', 'pending_generation', 'generating', 'generation_queued']);

    if (tilesError) throw tilesError;

    // Cancel parent jobs
    const { count: parentCount, error: parentError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .update({ status: 'failed', error_message: cancellationReason })
      .in('id', parentJobIds);

    if (parentError) throw parentError;
    
    const message = `Successfully cancelled ${parentCount || 0} parent job(s) and ${tilesCount || 0} active child tile(s).`;
    console.log(message);

    return new Response(JSON.stringify({ success: true, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[AdminCancelTiledUpscaleJobs] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});