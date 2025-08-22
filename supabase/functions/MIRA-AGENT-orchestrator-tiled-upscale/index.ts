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
    const { 
        source_image_url, // For single jobs
        source_image_urls, // For batch jobs
        user_id, 
        upscale_factor = 2.0, 
        source_job_id, 
        upscaler_engine, 
        tile_size,
        batch_name // For batch jobs
    } = await req.json();

    if (!user_id) {
      throw new Error("user_id is required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[TiledUpscaleOrchestrator]`;

    // --- BATCH JOB LOGIC ---
    if (Array.isArray(source_image_urls) && source_image_urls.length > 0) {
        console.log(`${logPrefix} Received batch request with ${source_image_urls.length} images.`);

        const { data: batchJob, error: batchInsertError } = await supabase
            .from('tiled_upscale_batch_jobs')
            .insert({
                user_id,
                name: batch_name || `Batch Job - ${new Date().toLocaleString()}`,
                total_jobs: source_image_urls.length,
                status: 'processing'
            })
            .select('id')
            .single();
        
        if (batchInsertError) throw batchInsertError;
        const batchId = batchJob.id;
        console.log(`${logPrefix} Created batch record with ID: ${batchId}`);

        const jobsToInsert = source_image_urls.map(url => {
            const { bucket, path } = parseStorageURL(url);
            return {
                user_id,
                source_image_url: url,
                source_bucket: bucket,
                source_path: path,
                upscale_factor,
                source_job_id,
                status: 'pending', // Set status to pending to enter the queue
                metadata: { 
                    upscaler_engine: upscaler_engine || Deno.env.get('DEFAULT_UPSCALER_ENGINE') || 'enhancor_detailed',
                    tile_size: tile_size
                },
                batch_id: batchId
            };
        });

        const { data: newJobs, error: jobsInsertError } = await supabase
            .from('mira_agent_tiled_upscale_jobs')
            .insert(jobsToInsert)
            .select('id');

        if (jobsInsertError) throw jobsInsertError;
        console.log(`${logPrefix} Inserted ${newJobs.length} individual jobs linked to batch ${batchId}.`);

        // Asynchronously "nudge" the watchdog to start processing immediately.
        // Don't await this call.
        supabase.functions.invoke('MIRA-AGENT-watchdog-tiled-upscale').catch(console.error);

        return new Response(JSON.stringify({ success: true, batchId: batchId }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    // --- SINGLE JOB LOGIC ---
    } else if (source_image_url) {
        console.log(`${logPrefix} Received single job request.`);
        const { bucket, path } = parseStorageURL(source_image_url);
        const finalEngine = upscaler_engine || Deno.env.get('DEFAULT_UPSCALER_ENGINE') || 'enhancor_detailed';

        const { data: newJob, error: insertError } = await supabase
          .from('mira_agent_tiled_upscale_jobs')
          .insert({
            user_id,
            source_image_url,
            source_bucket: bucket,
            source_path: path,
            upscale_factor,
            source_job_id,
            status: 'pending', // Set status to pending to enter the queue
            metadata: { 
                upscaler_engine: finalEngine,
                tile_size: tile_size
            }
          })
          .select('id')
          .single();

        if (insertError) throw insertError;
        const parentJobId = newJob.id;
        console.log(`${logPrefix} Parent job ${parentJobId} created and queued.`);

        // Asynchronously "nudge" the watchdog to start processing immediately.
        // Don't await this call.
        // NOTE: The number of concurrent jobs is controlled by the 'TILED_UPSCALE_CONCURRENCY_LIMIT'
        // key in the 'mira-agent-config' table in your Supabase project.
        supabase.functions.invoke('MIRA-AGENT-watchdog-tiled-upscale').catch(console.error);

        return new Response(JSON.stringify({ success: true, jobId: parentJobId }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        });
    } else {
        throw new Error("Request must include either 'source_image_url' (string) or 'source_image_urls' (array).");
    }

  } catch (error) {
    console.error("[TiledUpscaleOrchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});