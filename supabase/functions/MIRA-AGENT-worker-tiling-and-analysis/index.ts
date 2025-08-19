import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TILE_UPLOAD_BUCKET = "mira-agent-upscale-tiles";

const TILE_SIZE = 1024;
const TILE_OVERLAP = 264;
const STEP = TILE_SIZE - TILE_OVERLAP;

// tune these to your memory budget
const MAX_CONCURRENCY = Number(Deno.env.get("TILE_ANALYSIS_CONCURRENCY") ?? 2);
const INSERT_BATCH_SIZE = Number(Deno.env.get("TILE_INSERT_BATCH_SIZE") ?? 100);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function downloadImage(supabase: any, publicUrl: string): Promise<Blob> {
  const url = new URL(publicUrl);
  const segs = url.pathname.split("/");
  const publicIdx = segs.indexOf("public");
  const bucketName = segs[publicIdx + 1];
  const filePath = decodeURIComponent(segs.slice(segs.indexOf(bucketName) + 1).join("/"));

  const { data, error } = await supabase.storage.from(bucketName).download(filePath);
  if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { parent_job_id } = await req.json();
    if (!parent_job_id) throw new Error("parent_job_id is required.");

    const logPrefix = `[TilingAnalysisWorker][${parent_job_id}]`;
    console.log(`${logPrefix} Invoked. Concurrency=${MAX_CONCURRENCY}, DB Batch Size=${INSERT_BATCH_SIZE}.`);

    const { data: job, error: fetchError } = await supabase
      .from("mira_agent_tiled_upscale_jobs")
      .select("source_image_url, user_id, upscale_factor")
      .eq("id", parent_job_id)
      .single();
    if (fetchError) throw fetchError;
    console.log(`${logPrefix} Fetched parent job details.`);

    const downloadStart = performance.now();
    console.log(`${logPrefix} Downloading source image from ${job.source_image_url}`);
    const imageBlob = await downloadImage(supabase, job.source_image_url);
    console.log(`${logPrefix} Download complete in ${(performance.now() - downloadStart).toFixed(2)}ms. Blob size: ${imageBlob.size} bytes.`);

    const decodeStart = performance.now();
    const image = await Image.decode(await imageBlob.arrayBuffer());
    console.log(`${logPrefix} Decoded image in ${(performance.now() - decodeStart).toFixed(2)}ms. Original dimensions: ${image.width}x${image.height}`);

    const resizeStart = performance.now();
    const newWidth = Math.round(image.width * job.upscale_factor);
    console.log(`${logPrefix} Performing bicubic upscale to target width=${newWidth}...`);
    image.resize(newWidth, Image.RESIZE_AUTO, Image.RESIZE_BICUBIC);
    console.log(`${logPrefix} Upscale complete in ${(performance.now() - resizeStart).toFixed(2)}ms. Final dimensions: ${image.width}x${image.height}`);

    const coords: Array<{ x: number; y: number; w: number; h: number; idx: number }> = [];
    let idx = 0;
    for (let y = 0; y < image.height; y += STEP) {
      for (let x = 0; x < image.width; x += STEP) {
        coords.push({ x, y, w: TILE_SIZE, h: TILE_SIZE, idx: idx++ });
      }
    }
    console.log(`${logPrefix} Calculated ${coords.length} tile coordinates. Starting worker pool...`);

    let next = 0;
    const batch: any[] = [];

    async function flushBatch() {
      if (batch.length === 0) return;
      const toInsert = batch.splice(0, batch.length);
      console.log(`${logPrefix} Flushing ${toInsert.length} records to the database...`);
      const flushStart = performance.now();
      const { error: insertError } = await supabase.from("mira_agent_tiled_upscale_tiles").insert(toInsert);
      if (insertError) throw insertError;
      console.log(`${logPrefix} Database batch insert successful in ${(performance.now() - flushStart).toFixed(2)}ms.`);
    }

    async function processOne(workerId: number) {
      while (true) {
        const i = next++;
        if (i >= coords.length) break;

        const { x, y, w, h, idx } = coords[i];
        const tileLogPrefix = `${logPrefix}[W${workerId}][Tile ${idx}]`;

        try {
          const tileProcessStart = performance.now();
          console.log(`${tileLogPrefix} Processing tile at (${x}, ${y}).`);

          const cropStart = performance.now();
          const tile = image.clone();
          tile.crop(x, y, w, h);
          console.log(`${tileLogPrefix} Cropped in ${(performance.now() - cropStart).toFixed(2)}ms.`);

          const encodeStart = performance.now();
          const tileBuffer = await tile.encode(0);
          console.log(`${tileLogPrefix} Encoded to PNG buffer (${tileBuffer.length} bytes) in ${(performance.now() - encodeStart).toFixed(2)}ms.`);

          const analysisStart = performance.now();
          const tileBase64 = encodeBase64(tileBuffer);
          const { data, error } = await supabase.functions.invoke("MIRA-AGENT-worker-tile-analyzer", {
            body: { tile_base64: tileBase64, mime_type: "image/png" },
          });
          if (error) throw error;
          console.log(`${tileLogPrefix} Analysis complete in ${(performance.now() - analysisStart).toFixed(2)}ms. Caption: "${data?.prompt?.substring(0, 50)}..."`);

          const uploadStart = performance.now();
          const filePath = `${job.user_id}/${parent_job_id}/tile_${idx}.png`;
          await supabase.storage.from(TILE_UPLOAD_BUCKET).upload(filePath, tileBuffer, {
            contentType: "image/png",
            upsert: true,
          });
          const { data: { publicUrl } } = supabase.storage.from(TILE_UPLOAD_BUCKET).getPublicUrl(filePath);
          console.log(`${tileLogPrefix} Uploaded to storage in ${(performance.now() - uploadStart).toFixed(2)}ms.`);

          batch.push({
            parent_job_id,
            tile_index: idx,
            coordinates: { x, y, width: w, height: h },
            source_tile_url: publicUrl,
            generated_prompt: data?.prompt ?? null,
            status: "pending_generation",
          });

          if (batch.length >= INSERT_BATCH_SIZE) {
            await flushBatch();
          }
          console.log(`${tileLogPrefix} Finished processing in ${(performance.now() - tileProcessStart).toFixed(2)}ms.`);
        } catch (e) {
          console.error(`${tileLogPrefix} FAILED:`, e);
          batch.push({
            parent_job_id,
            tile_index: idx,
            coordinates: { x, y, width: w, height: h },
            source_tile_url: null,
            generated_prompt: null,
            status: "analysis_failed",
            error_message: String(e?.message ?? e),
          });
          if (batch.length >= INSERT_BATCH_SIZE) {
            await flushBatch();
          }
        }
      }
    }

    const workers = Array.from({ length: Math.max(1, MAX_CONCURRENCY) }, (_, i) => processOne(i + 1));
    await Promise.all(workers);
    await flushBatch(); // Flush any remaining items in the batch

    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "generating" }).eq("id", parent_job_id);
    console.log(`${logPrefix} All tiles processed. Parent job status updated to 'generating'.`);

    return new Response(JSON.stringify({ success: true, tileCount: coords.length }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[TilingAnalysisWorker] FATAL ERROR:`, error);
    try {
      const { parent_job_id } = await req.json().catch(() => ({}));
      if (parent_job_id) {
        await supabase
          .from("mira_agent_tiled_upscale_jobs")
          .update({ status: "failed", error_message: `Tiling & Analysis failed: ${error.message}` })
          .eq("id", parent_job_id);
      }
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});