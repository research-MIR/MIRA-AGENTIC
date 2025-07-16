import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALLED_THRESHOLD_SECONDS = 30;

serve(async (req) => {
  console.log("ComfyUI Watchdog: Function invoked.");

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_SECONDS * 1000).toISOString();
    console.log(`ComfyUI Watchdog: Checking for jobs stalled since ${threshold}`);

    // Fetch stalled jobs from all three tables
    const { data: stalledRefinerJobs, error: refinerError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('id')
      .in('status', ['queued', 'processing'])
      .lt('last_polled_at', threshold);

    const { data: stalledInpaintingJobs, error: inpaintingError } = await supabase
      .from('mira-agent-inpainting-jobs')
      .select('id')
      .in('status', ['queued', 'processing'])
      .lt('last_polled_at', threshold);

    const { data: stalledModelGenJobs, error: modelGenError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .select('id')
      .in('status', ['pending', 'base_generation_complete', 'generating_poses', 'polling_poses', 'upscaling_poses'])
      .lt('last_polled_at', threshold);

    if (refinerError) console.error("Error querying refiner jobs:", refinerError.message);
    if (inpaintingError) console.error("Error querying inpainting jobs:", inpaintingError.message);
    if (modelGenError) console.error("Error querying model generation jobs:", modelGenError.message);

    const allStalledJobs = [
        ...(stalledRefinerJobs || []).map(job => ({ ...job, type: 'refiner' })),
        ...(stalledInpaintingJobs || []).map(job => ({ ...job, type: 'inpainting' })),
        ...(stalledModelGenJobs || []).map(job => ({ ...job, type: 'model-generation' }))
    ];

    if (allStalledJobs.length === 0) {
      const message = "ComfyUI Watchdog: No stalled jobs found in any queue. Check complete.";
      console.log(message);
      return new Response(JSON.stringify({ message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }

    console.log(`ComfyUI Watchdog: Found ${allStalledJobs.length} total stalled job(s). Re-triggering pollers...`);

    const triggerPromises = allStalledJobs.map(job => {
      let pollerName = '';
      switch (job.type) {
        case 'refiner': pollerName = 'MIRA-AGENT-poller-comfyui'; break;
        case 'inpainting': pollerName = 'MIRA-AGENT-poller-inpainting'; break;
        case 'model-generation': pollerName = 'MIRA-AGENT-poller-model-generation'; break;
        default: return Promise.resolve();
      }
      console.log(`ComfyUI Watchdog: Re-triggering ${pollerName} for stalled job ID: ${job.id}`);
      return supabase.functions.invoke(pollerName, { body: { job_id: job.id } });
    });

    await Promise.allSettled(triggerPromises);

    const successMessage = `ComfyUI Watchdog: Successfully re-triggered ${allStalledJobs.length} stalled job(s).`;
    console.log(successMessage);
    return new Response(JSON.stringify({ message: successMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error) {
    console.error("ComfyUI Watchdog: Unhandled error:", error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});