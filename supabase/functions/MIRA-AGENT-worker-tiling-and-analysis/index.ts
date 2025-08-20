// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TILE_UPLOAD_BUCKET = "mira-agent-upscale-tiles";

const TILE_SIZE = 1024;
const TILE_OVERLAP = 264;
const STEP = TILE_SIZE - TILE_OVERLAP;

const MAX_CONCURRENCY = Number(Deno.env.get("TILE_ANALYSIS_CONCURRENCY") ?? 2);
const INSERT_BATCH_SIZE = Number(Deno.env.get("TILE_INSERT_BATCH_SIZE") ?? 100);
const TILE_ANALYSIS_MEM_BUDGET_MB = Number(Deno.env.get("TILE_ANALYSIS_MEM_BUDGET_MB") ?? 256);

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

function toObject(maybeJson: unknown) {
  if (typeof maybeJson === "string") {
    try { return JSON.parse(maybeJson); }
    catch { return { error: "non-json-string", raw: maybeJson }; }
  }
  return maybeJson ?? {};
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let parent_job_id: string | undefined;

  try {
    const body = await req.json();
    parent_job_id = body?.parent_job_id;
    if (!parent_job_id) throw new Error("parent_job_id is required.");

    const logPrefix = `[TilingAnalysisWorker][${parent_job_id}]`;
    console.log(`${logPrefix} Invoked. Concurrency=${MAX_CONCURRENCY}, DB Batch Size=${INSERT_BATCH_SIZE}`);

    const { data: job, error: fetchError } = await supabase
      .from("mira_agent_tiled_upscale_jobs")
      .select("source_image_url, user_id, upscale_factor")
      .eq("id", parent_job_id)
      .single();
    if (fetchError) throw fetchError;
    console.log(`${logPrefix} Fetched parent job details.`);

    const dl0 = performance.now();
    const blob = await downloadImage(supabase, job.source_image_url);
    console.log(`${logPrefix} Download in ${(performance.now() - dl0).toFixed(2)}ms, blob=${blob.size}B`);

    const img = await Image.decode(await blob.arrayBuffer());
    console.log(`${logPrefix} Decoded ${img.width}x${img.height}`);

    const scale = job.upscale_factor;
    const BASE_TILE = Math.ceil(TILE_SIZE / scale);
    const BASE_OVERLAP = Math.ceil(TILE_OVERLAP / scale);
    const BASE_STEP = BASE_TILE - BASE_OVERLAP;

    const tilesX = img.width <= BASE_TILE ? 1 : 1 + Math.ceil((img.width - BASE_TILE) / BASE_STEP);
    const tilesY = img.height <= BASE_TILE ? 1 : 1 + Math.ceil((img.height - BASE_TILE) / BASE_STEP);
    const totalTiles = tilesX * tilesY;
    console.log(`${logPrefix} Tiling at base scale. Base Tile: ${BASE_TILE}px, Total Tiles: ${totalTiles} (${tilesX}x${tilesY})`);

    const estImgBytes = img.width * img.height * 4;
    const perWorkerBytes = (BASE_TILE * BASE_TILE * 4) + (2 * 1024 * 1024);
    const budget = TILE_ANALYSIS_MEM_BUDGET_MB * 1024 * 1024;
    if (estImgBytes + perWorkerBytes > budget) {
        throw new Error(`Source image too large for analysis memory budget (${TILE_ANALYSIS_MEM_BUDGET_MB} MB).`);
    }
    const EFFECTIVE_CONCURRENCY = Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor((budget - estImgBytes) / perWorkerBytes)));
    console.log(`${logPrefix} Effective concurrency set to ${EFFECTIVE_CONCURRENCY} based on memory budget.`);

    const mime = "image/jpeg";
    const fmt = 1; // JPEG
    const quality = 85;

    let next = 0;
    const batch: any[] = [];

    async function flushBatch() {
      if (!batch.length) return;
      const chunk = batch.splice(0, batch.length);
      const t0 = performance.now();
      const { error } = await supabase.from("mira_agent_tiled_upscale_tiles").upsert(chunk, { onConflict: "parent_job_id,tile_index" });
      if (error) throw error;
      console.log(`${logPrefix} Upserted ${chunk.length} rows in ${(performance.now() - t0).toFixed(2)}ms`);
    }

    async function processOne(workerId: number) {
      while (true) {
        const i = next++;
        if (i >= totalTiles) break;

        const gx = i % tilesX;
        const gy = Math.floor(i / tilesX);
        
        let srcX = gx * BASE_STEP;
        if (gx === tilesX - 1) srcX = img.width - BASE_TILE;
        srcX = Math.max(0, srcX);

        let srcY = gy * BASE_STEP;
        if (gy === tilesY - 1) srcY = img.height - BASE_TILE;
        srcY = Math.max(0, srcY);

        const tag = `${logPrefix}[W${workerId}][Tile ${i}]`;
        try {
          const tileImg = new Image(BASE_TILE, BASE_TILE);
          tileImg.composite(img, -srcX, -srcY);
          const tileBuffer = await tileImg.encode(fmt, quality);

          const filePath = `${job.user_id}/${parent_job_id}/tile_${i}.jpeg`;
          await supabase.storage.from(TILE_UPLOAD_BUCKET).upload(filePath, tileBuffer, { contentType: mime, upsert: true, cacheControl: "31536000, immutable" });
          const { data: { publicUrl } } = supabase.storage.from(TILE_UPLOAD_BUCKET).getPublicUrl(filePath);

          const { data, error } = await supabase.functions.invoke("MIRA-AGENT-worker-tile-analyzer", {
            body: { tile_url: publicUrl, mime_type: mime }
          });

          if (error) throw new Error(`Function invocation failed: ${error.message || JSON.stringify(error)}`);
          const payload = toObject(data);
          if (payload && payload.error && !payload.prompt) throw new Error(`Analyzer function returned an error: ${JSON.stringify(payload)}`);
          const caption = typeof payload?.prompt === "string" ? payload.prompt : null;

          const tileRecord = {
            parent_job_id,
            tile_index: i,
            coordinates: { 
                x: gx * STEP, y: gy * STEP, width: TILE_SIZE, height: TILE_SIZE,
                scale: scale,
                source: { x: srcX, y: srcY, width: BASE_TILE, height: BASE_TILE }
            },
            source_tile_url: publicUrl,
            generated_prompt: caption,
            status: "pending_generation",
          };
          batch.push(tileRecord);
          console.log(`${tag} Record prepared. Prompt length: ${caption ? caption.length : 0}`);

          if (batch.length >= INSERT_BATCH_SIZE) await flushBatch();
          if ((i & 15) === 0) await new Promise(r => setTimeout(r, 0));

        } catch (e) {
          console.error(`${tag} FAILED:`, e);
          batch.push({
            parent_job_id,
            tile_index: i,
            coordinates: { x: gx * STEP, y: gy * STEP, width: TILE_SIZE, height: TILE_SIZE },
            status: "analysis_failed",
            error_message: String(e?.message ?? e),
          });
          if (batch.length >= INSERT_BATCH_SIZE) await flushBatch();
        }
      }
    }

    const workers = Array.from({ length: EFFECTIVE_CONCURRENCY }, (_, k) => processOne(k + 1));
    await Promise.all(workers);
    await flushBatch();

    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "generating" }).eq("id", parent_job_id);
    console.log(`${logPrefix} Done.`);

    return new Response(JSON.stringify({ success: true, tileCount: totalTiles }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[TilingAnalysisWorker] FATAL:`, error);
    if (parent_job_id) {
      try {
        await createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
          .from("mira_agent_tiled_upscale_jobs")
          .update({ status: "failed", error_message: `Tiling & Analysis failed: ${error.message}` })
          .eq("id", parent_job_id);
      } catch {}
    }
    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});