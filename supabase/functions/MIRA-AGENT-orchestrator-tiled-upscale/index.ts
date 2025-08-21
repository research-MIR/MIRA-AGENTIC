import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function parseStorageURL(url: string) {
    const u = new URL(url);
    const pathSegments = u.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Invalid Supabase storage URL format: ${url}`);
    }
    const bucket = pathSegments[objectSegmentIndex + 2];
    const path = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    if (!bucket || !path) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${url}`);
    }
    return { bucket, path };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { source_image_url, user_id, upscale_factor = 2.0, source_job_id, upscaler_engine } = await req.json();
    if (!source_image_url || !user_id) {
      throw new Error("source_image_url and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    // Set the new default engine as per the plan
    const finalEngine = upscaler_engine || Deno.env.get('DEFAULT_UPSCALER_ENGINE') || 'comfyui_fal_upscaler';

    const logPrefix = `[TiledUpscaleOrchestrator]`;
    console.log(`${logPrefix} Creating new upscale job record with engine: ${finalEngine}.`);

    const { bucket, path } = parseStorageURL(source_image_url);

    const { data: newJob, error: insertError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .insert({
        user_id,
        source_image_url,
        source_bucket: bucket,
        source_path: path,
        upscale_factor,
        source_job_id,
        status: 'tiling',
        metadata: { upscaler_engine: finalEngine }
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    const parentJobId = newJob.id;
    console.log(`${logPrefix} Parent job ${parentJobId} created. Invoking tiling worker.`);

    supabase.functions.invoke('MIRA-AGENT-worker-tiling-and-analysis', {
      body: { parent_job_id: parentJobId }
    }).catch(err => {
      console.error(`${logPrefix} Failed to invoke tiling worker for job ${parentJobId}:`, err);
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