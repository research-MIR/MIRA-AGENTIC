import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-agent-upscale-tiles';

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

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[FalComfyUI-Webhook]`;

  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    const tileId = url.searchParams.get('tile_id');

    if (!jobId || !tileId) {
      throw new Error("Webhook received without job_id or tile_id in the query parameters.");
    }
    console.log(`${logPrefix} Received webhook for job ${jobId}, tile ${tileId}.`);

    const payload = await req.json();
    const { status, payload: resultPayload, error: falError } = payload;

    let parentJobId: string | null = null;

    if (status === 'OK' && resultPayload) {
      console.log(`${logPrefix} Job ${jobId} completed successfully.`);
      const imageUrl = resultPayload?.outputs?.['283']?.images?.[0]?.url;
      if (!imageUrl) {
        throw new Error("Fal.ai webhook payload is missing the expected image URL in outputs.283.images[0].url");
      }

      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) throw new Error(`Failed to download final image from Fal.ai: ${imageResponse.statusText}`);
      const imageBuffer = await imageResponse.arrayBuffer();

      const filePath = `${jobId}/final.png`;
      await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
      
      const updatePayload: any = {
          status: 'complete',
          generated_tile_bucket: GENERATED_IMAGES_BUCKET,
          generated_tile_path: filePath,
      };

      if (imageUrl.includes('supabase.co')) {
          const { bucket, path } = parseStorageURL(imageUrl);
          updatePayload.generated_tile_bucket = bucket;
          updatePayload.generated_tile_path = path;
      }

      const { data: updatedTile, error: updateTileError } = await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update(updatePayload)
        .eq('id', tileId)
        .select('parent_job_id')
        .single();

      if (updateTileError) throw updateTileError;
      parentJobId = updatedTile.parent_job_id;
      
      await supabase
        .from('fal_comfyui_jobs')
        .update({ status: 'complete', final_result: resultPayload })
        .eq('id', jobId);

      console.log(`${logPrefix} Tile ${tileId} successfully finalized and stored at ${filePath}.`);

    } else {
      const errorMessage = `Fal.ai reported failure. Status: ${status}. Error: ${JSON.stringify(falError || payload)}`;
      console.error(`${logPrefix} Job ${jobId} failed: ${errorMessage}`);
      
      const { data: updatedTile, error: updateTileError } = await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({ status: 'generation_failed', error_message: errorMessage })
        .eq('id', tileId)
        .select('parent_job_id')
        .single();
      
      if (updateTileError) throw updateTileError;
      parentJobId = updatedTile.parent_job_id;
      
      await supabase
        .from('fal_comfyui_jobs')
        .update({ status: 'failed', error_message: errorMessage })
        .eq('id', jobId);
    }

    // --- Real-time Compositor Trigger ---
    if (parentJobId) {
        console.log(`${logPrefix} Performing ready-check for parent job ${parentJobId}...`);
        const { data: parentJob, error: parentJobError } = await supabase
            .from('mira_agent_tiled_upscale_jobs')
            .select('total_tiles, status')
            .eq('id', parentJobId)
            .single();

        if (parentJobError) throw parentJobError;

        const { count: completedCount, error: countError } = await supabase
            .from('mira_agent_tiled_upscale_tiles')
            .select('*', { count: 'exact', head: true })
            .eq('parent_job_id', parentJobId)
            .eq('status', 'complete');
        
        if (countError) throw countError;

        console.log(`${logPrefix} Parent job ${parentJobId} status: ${parentJob.status}. Tiles: ${completedCount}/${parentJob.total_tiles} complete.`);

        if (parentJob.total_tiles > 0 && completedCount !== null && completedCount >= parentJob.total_tiles) {
            console.log(`${logPrefix} All tiles for job ${parentJobId} are complete. Attempting to trigger compositor.`);
            const { data: claimed, error: rpcError } = await supabase.rpc('try_set_job_to_compositing', { p_job_id: parentJobId });
            if (rpcError) {
                console.error(`${logPrefix} RPC try_set_job_to_compositing failed for job ${parentJobId}:`, rpcError.message);
            } else if (claimed) {
                console.log(`${logPrefix} Successfully claimed job ${parentJobId} via RPC. Invoking compositor.`);
                supabase.functions.invoke('MIRA-AGENT-compositor-tiled-upscale', { body: { parent_job_id: parentJobId } }).catch(console.error);
            } else {
                console.log(`${logPrefix} Job ${parentJobId} was already claimed by another instance. Skipping invocation.`);
            }
        }
    }
    // --- End Trigger ---

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});