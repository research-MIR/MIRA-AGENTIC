import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TILE_UPLOAD_BUCKET = 'mira-agent-upscale-tiles';
const TILE_SIZE = 1024;
const TILE_OVERLAP = 264;

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
  const logPrefix = `[TilingAnalysisWorker][${parent_job_id}]`;

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira_agent_tiled_upscale_jobs')
      .select('source_image_url, user_id, upscale_factor')
      .eq('id', parent_job_id)
      .single();
    if (fetchError) throw fetchError;

    console.log(`${logPrefix} Downloading and decoding source image from ${job.source_image_url}`);
    const imageBlob = await downloadImage(supabase, job.source_image_url);
    const image = await Image.decode(await imageBlob.arrayBuffer());
    console.log(`${logPrefix} Original dimensions: ${image.width}x${image.height}`);

    const newWidth = Math.round(image.width * job.upscale_factor);
    console.log(`${logPrefix} Performing preliminary upscale to ${newWidth}px width...`);
    image.resize(newWidth, Image.RESIZE_AUTO, Image.RESIZE_BICUBIC);
    console.log(`${logPrefix} Upscaled dimensions: ${image.width}x${image.height}`);

    const tilesToProcess = [];
    const stepSize = TILE_SIZE - TILE_OVERLAP;
    for (let y = 0; y < image.height; y += stepSize) {
      for (let x = 0; x < image.width; x += stepSize) {
        const tile = image.clone().crop(x, y, TILE_SIZE, TILE_SIZE);
        tilesToProcess.push({
          tile,
          coordinates: { x, y, width: TILE_SIZE, height: TILE_SIZE }
        });
      }
    }
    console.log(`${logPrefix} Sliced image into ${tilesToProcess.length} tiles. Dispatching for parallel analysis...`);

    const analysisPromises = tilesToProcess.map(async ({ tile, coordinates }) => {
      const tileBuffer = await tile.encode(0); // PNG format
      const tileBase64 = encodeBase64(tileBuffer);
      const { data, error } = await supabase.functions.invoke('MIRA-AGENT-worker-tile-analyzer', {
        body: { tile_base64: tileBase64, mime_type: 'image/png' }
      });
      if (error) throw error;
      return { caption: data.prompt, tileBuffer, coordinates };
    });

    const analysisResults = await Promise.all(analysisPromises);
    console.log(`${logPrefix} All ${analysisResults.length} tiles have been analyzed.`);

    const finalTileRecords = [];
    for (const [index, result] of analysisResults.entries()) {
      const filePath = `${job.user_id}/${parent_job_id}/tile_${index}.png`;
      await supabase.storage.from(TILE_UPLOAD_BUCKET).upload(filePath, result.tileBuffer, { contentType: 'image/png', upsert: true });
      const { data: { publicUrl } } = supabase.storage.from(TILE_UPLOAD_BUCKET).getPublicUrl(filePath);
      
      finalTileRecords.push({
        parent_job_id,
        tile_index: index,
        coordinates: result.coordinates,
        source_tile_url: publicUrl,
        generated_prompt: result.caption,
        status: 'pending_generation'
      });
    }
    console.log(`${logPrefix} All ${finalTileRecords.length} tiles uploaded to storage.`);

    const { error: insertError } = await supabase.from('mira_agent_tiled_upscale_tiles').insert(finalTileRecords);
    if (insertError) throw insertError;

    await supabase.from('mira_agent_tiled_upscale_jobs').update({ status: 'generating' }).eq('id', parent_job_id);
    console.log(`${logPrefix} Tiling and analysis complete. Parent job status updated to 'generating'.`);

    return new Response(JSON.stringify({ success: true, tileCount: finalTileRecords.length }), { headers: corsHeaders });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira_agent_tiled_upscale_jobs').update({ status: 'failed', error_message: `Tiling & Analysis failed: ${error.message}` }).eq('id', parent_job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});