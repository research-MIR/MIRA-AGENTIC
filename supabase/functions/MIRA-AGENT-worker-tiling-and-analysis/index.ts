import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TILE_UPLOAD_BUCKET = "mira-agent-upscale-tiles";

const TILE_SIZE = 1024;
const TILE_OVERLAP = 264;
const STEP = TILE_SIZE - TILE_OVERLAP;

// tune per budget
const MAX_CONCURRENCY = Number(Deno.env.get("TILE_ANALYSIS_CONCURRENCY") ?? 2);
const INSERT_BATCH_SIZE = Number(Deno.env.get("TILE_INSERT_BATCH_SIZE") ?? 100);

// encode settings
const ANALYZER_INPUT = (Deno.env.get("ANALYZER_INPUT") ?? "url").toLowerCase(); // "url" | "base64"

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
    console.log(`${logPrefix} Invoked. Concurrency=${MAX_CONCURRENCY}, DB Batch Size=${INSERT_BATCH_SIZE}, Encode=PNG, Input=${ANALYZER_INPUT}`);

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

    const targetW = Math.round(img.width * job.upscale_factor);
    img.resize(targetW, Image.RESIZE_AUTO, Image.RESIZE_BICUBIC);
    console.log(`${logPrefix} Upscaled -> ${img.width}x${img.height}`);

    const tilesX = Math.ceil(img.width / STEP);
    const tilesY = Math.ceil(img.height / STEP);
    const totalTiles = tilesX * tilesY;
    console.log(`${logPrefix} totalTiles=${totalTiles} (grid ${tilesX}x${tilesY})`);

    const mime = "image/png";
    const fmt = 0; // imagescript: 0=PNG
    const fileExt = "png";

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
        const gy = (i / tilesX) | 0;
        const x = gx * STEP;
        const y = gy * STEP;
        const idx = i;

        const tag = `${logPrefix}[W${workerId}][Tile ${idx}]`;
        try {
          const tile = new Image(TILE_SIZE, TILE_SIZE);
          tile.composite(img, -x, -y);

          const enc0 = performance.now();
          const tileBuffer = await tile.encode(fmt);
          const encMs = (performance.now() - enc0).toFixed(2);

          const filePath = `${job.user_id}/${parent_job_id}/tile_${idx}.${fileExt}`;
          const up0 = performance.now();
          await supabase.storage.from(TILE_UPLOAD_BUCKET).upload(filePath, tileBuffer, {
            contentType: mime,
            upsert: true,
          });
          const { data: { publicUrl } } = supabase.storage.from(TILE_UPLOAD_BUCKET).getPublicUrl(filePath);
          const upMs = (performance.now() - up0).toFixed(2);

          const an0 = performance.now();
          const { data, error } = await supabase.functions.invoke("MIRA-AGENT-worker-tile-analyzer", {
            body: ANALYZER_INPUT === "url"
              ? { tile_url: publicUrl, mime_type: mime }
              : { tile_base64: encodeBase64(tileBuffer), mime_type: mime }
          });

          console.log(`${tag} Analyzer response: data=${JSON.stringify(data)}, error=${JSON.stringify(error)}`);
          if (error) throw new Error(`Function invocation failed: ${error.message || JSON.stringify(error)}`);

          const payload = toObject(data);
          if (payload && payload.error && !payload.prompt) {
            throw new Error(`Analyzer function returned an error shape: ${JSON.stringify(payload)}`);
          }
          const caption = typeof payload?.prompt === "string" ? payload.prompt : null;
          const anMs = (performance.now() - an0).toFixed(2);

          const tileRecord = {
            parent_job_id,
            tile_index: idx,
            coordinates: { x, y, width: TILE_SIZE, height: TILE_SIZE },
            source_tile_url: publicUrl,
            generated_prompt: caption,
            status: "pending_generation",
          };
          batch.push(tileRecord);
          console.log(`${tag} Record prepared for DB: ${JSON.stringify(tileRecord)}`);

          if (batch.length >= INSERT_BATCH_SIZE) await flushBatch();

          console.log(`${tag} Encoded(${mime}) ${tileBuffer.length}B in ${encMs}ms, uploaded in ${upMs}ms, analyzed in ${anMs}ms`);
          await Promise.resolve();
        } catch (e) {
          console.error(`${tag} FAILED:`, e);
          batch.push({
            parent_job_id,
            tile_index: idx,
            coordinates: { x, y, width: TILE_SIZE, height: TILE_SIZE },
            source_tile_url: null,
            generated_prompt: null,
            status: "analysis_failed",
            error_message: String(e?.message ?? e),
          });
          if (batch.length >= INSERT_BATCH_SIZE) await flushBatch();
        }
      }
    }

    const workers = Array.from({ length: Math.max(1, MAX_CONCURRENCY) }, (_, k) => processOne(k + 1));
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