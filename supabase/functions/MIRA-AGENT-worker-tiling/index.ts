import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TILE_UPLOAD_BUCKET = 'mira-agent-upscale-tiles';
const TILE_SIZE = 512;
const TILE_OVERLAP = 64;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function downloadImage(supabase: SupabaseClient, publicUrl: string) {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { parent_job_id } = await req.json();
  if (!parent_job_id) throw new Error("parent_job_id is required.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TilingWorker][${parent_job_id}]`;

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .select('source_image_url, user_id')
      .eq('id', parent_job_id)
      .single();
    if (fetchError) throw fetchError;

    console.log(`${logPrefix} Downloading source image from ${job.source_image_url}`);
    const imageBlob = await downloadImage(supabase, job.source_image_url);
    const image = await Image.decode(await imageBlob.arrayBuffer());
    console.log(`${logPrefix} Image decoded. Dimensions: ${image.width}x${image.height}`);

    const tilesToCreate = [];
    const stepSize = TILE_SIZE - TILE_OVERLAP;

    for (let y = 0; y < image.height; y += stepSize) {
      for (let x = 0; x < image.width; x += stepSize) {
        const tile = image.clone().crop(x, y, TILE_SIZE, TILE_SIZE);
        tilesToCreate.push({
          tile,
          coordinates: { x, y, width: TILE_SIZE, height: TILE_SIZE }
        });
      }
    }
    console.log(`${logPrefix} Sliced image into ${tilesToCreate.length} tiles.`);

    const uploadPromises = tilesToCreate.map(async ({ tile, coordinates }, index) => {
      const tileBuffer = await tile.encode(0); // PNG format
      const filePath = `${job.user_id}/${parent_job_id}/tile_${index}.png`;
      await supabase.storage.from(TILE_UPLOAD_BUCKET).upload(filePath, tileBuffer, { contentType: 'image/png', upsert: true });
      const { data: { publicUrl } } = supabase.storage.from(TILE_UPLOAD_BUCKET).getPublicUrl(filePath);
      return {
        parent_job_id,
        tile_index: index,
        coordinates,
        source_tile_url: publicUrl,
        status: 'pending_analysis'
      };
    });

    const tileRecords = await Promise.all(uploadPromises);
    console.log(`${logPrefix} All ${tileRecords.length} tiles uploaded to storage.`);

    const { error: insertError } = await supabase.from('mira_agent_tiled_upscale_tiles').insert(tileRecords);
    if (insertError) throw insertError;

    await supabase.from('mira_agent_tiled_upscale_jobs').update({ status: 'analyzing' }).eq('id', parent_job_id);
    console.log(`${logPrefix} Tiling complete. Parent job status updated to 'analyzing'.`);

    return new Response(JSON.stringify({ success: true, tileCount: tileRecords.length }), { headers: corsHeaders });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira_agent_tiled_upscale_jobs').update({ status: 'failed', error_message: `Tiling failed: ${error.message}` }).eq('id', parent_job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});