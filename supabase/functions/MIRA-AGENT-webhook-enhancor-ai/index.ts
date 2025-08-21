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
    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    const tileId = url.searchParams.get('tile_id'); // Check for tile_id

    if (!jobId) {
      throw new Error("Webhook received without a job_id in the query parameters.");
    }

    const payload = await req.json();
    const { result, status } = payload;

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Update the main Enhancor job table
    if (status === 'success' && result) {
      await supabase
        .from('enhancor_ai_jobs')
        .update({
          status: 'complete',
          final_image_url: result,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    } else {
      await supabase
        .from('enhancor_ai_jobs')
        .update({
          status: 'failed',
          error_message: `EnhancorAI reported failure. Status: ${status}. Full payload: ${JSON.stringify(payload)}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }

    // If a tile_id is present, also update the tiled pipeline table
    if (tileId) {
        console.log(`[EnhancorWebhook] Received tile_id: ${tileId}. Updating tile status.`);
        if (status === 'success' && result) {
            const updatePayload: any = {
                status: 'complete',
                generated_tile_url: result,
            };

            if (result.includes('supabase.co')) {
                const { bucket, path } = parseStorageURL(result);
                updatePayload.generated_tile_bucket = bucket;
                updatePayload.generated_tile_path = path;
            } else {
                // It's an external URL, so bucket and path are null
                updatePayload.generated_tile_bucket = null;
                updatePayload.generated_tile_path = null;
            }

            await supabase
                .from('mira_agent_tiled_upscale_tiles')
                .update(updatePayload)
                .eq('id', tileId);
        } else {
            await supabase
                .from('mira_agent_tiled_upscale_tiles')
                .update({
                    status: 'generation_failed',
                    error_message: `EnhancorAI reported failure for this tile. Status: ${status}.`
                })
                .eq('id', tileId);
        }
    }

    // Handle batch job update (for the batch test feature)
    const { data: job } = await supabase.from('enhancor_ai_jobs').select('metadata, enhancor_mode').eq('id', jobId).single();
    if (job?.metadata?.batch_job_id) {
      const { error: rpcError } = await supabase.rpc('update_enhancor_batch_job_result', {
        p_batch_job_id: job.metadata.batch_job_id,
        p_original_url: job.metadata.original_source_url,
        p_result_type: job.enhancor_mode,
        p_result_url: result || `FAILED: ${status}`
      });
      if (rpcError) console.error(`[EnhancorWebhook] Failed to update batch job:`, rpcError);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EnhancorAIWebhook] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});