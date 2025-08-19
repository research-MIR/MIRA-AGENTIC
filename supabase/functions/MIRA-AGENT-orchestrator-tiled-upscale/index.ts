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
    const { source_image_url, user_id, upscale_factor = 2.0, source_job_id } = await req.json();
    if (!source_image_url || !user_id) {
      throw new Error("source_image_url and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[TiledUpscaleOrchestrator]`;
    console.log(`${logPrefix} Creating new upscale job record.`);

    const { data: newJob, error: insertError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .insert({
        user_id,
        source_image_url,
        upscale_factor,
        source_job_id,
        status: 'tiling'
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    const parentJobId = newJob.id;
    console.log(`${logPrefix} Parent job ${parentJobId} created. Invoking tiling and analysis worker.`);

    // Asynchronously invoke the new, all-in-one worker.
    supabase.functions.invoke('MIRA-AGENT-worker-tiling-and-analysis', {
      body: { parent_job_id: parentJobId }
    }).catch(err => {
      console.error(`${logPrefix} Failed to invoke tiling worker for job ${parentJobId}:`, err);
      // Attempt to set an error state on the job
      supabase.from('mira_agent_tiled_upscale_jobs').update({
        status: 'failed',
        error_message: 'Failed to start the tiling process.'
      }).eq('id', parentJobId).then();
    });

    return new Response(JSON.stringify({ success: true, jobId: parentJobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[TiledUpscaleOrchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});