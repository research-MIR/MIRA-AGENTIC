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
const TILE_ENCODE = (Deno.env.get("TILE_ENCODE") ?? "webp").toLowerCase(); // "webp" | "jpeg" | "png"
const TILE_QUALITY = Number(Deno.env.get("TILE_QUALITY") ?? 85); // for webp/jpeg
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

function pickMimeAndFmt() {
  if (TILE_ENCODE === "webp") return { mime: "image/webp", fmt: 2 }; // imagescript: 0=PNG, 1=JPEG, 2=WEBP
  if (TILE_ENCODE === "jpeg" || TILE_ENCODE === "jpg") return { mime: "image/jpeg", fmt: 1 };
  return { mime: "image/png", fmt: 0 };
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
    console.log(`${logPrefix} Invoked. Concurrency=${MAX_CONCURRENCY}, DB Batch Size=${INSERT_BATCH_SIZE}, Encode=${TILE_ENCODE}@${TILE_QUALITY}, Input=${ANALYZER_INPUT}`);

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
    const img = await Image.decode(await imageBlob.arrayBuffer());
    console.log(`${logPrefix} Decoded image in ${(performance.now() - decodeStart).toFixed(2)}ms. Original dimensions: ${img.width}x${img.height}`);

    const targetW = Math.round(img.width * job.upscale_factor);
    img.resize(targetW, Image.RESIZE_AUTO, Image.RESIZE_BICUBIC);
    console.log(`${logPrefix} Upscaled -> ${img.width}x${img.height}`);

    const tilesX = Math.ceil(img.width / STEP);
    const tilesY = Math.ceil(img.height / STEP);
    const totalTiles = tilesX * tilesY;
    console.log(`${logPrefix} totalTiles=${totalTiles} (grid ${tilesX}x${tilesY})`);

    const { mime, fmt } = pickMimeAndFmt();
    let next = 0;
    const batch: any[] = [];

    async function flushBatch() {
      if (!batch.length) return;
      const chunk = batch.splice(0, batch.length);
      const t0 = performance.now();
      const { error } = await supabase.from("mira_agent_tiled_upscale_tiles").insert(chunk);
      if (error) throw error;
      console.log(`${logPrefix} Inserted ${chunk.length} rows in ${(performance.now() - t0).toFixed(2)}ms`);
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
          const tileBuffer = await tile.encode(fmt, TILE_QUALITY);
          const encMs = (performance.now() - enc0).toFixed(2);

          const fileExt = TILE_ENCODE === "png" ? "png" : TILE_ENCODE === "jpeg" || TILE_ENCODE === "jpg" ? "jpg" : "webp";
          const filePath = `${job.user_id}/${parent_job_id}/tile_${idx}.${fileExt}`;
          const up0 = performance.now();
          await supabase.storage.from(TILE_UPLOAD_BUCKET).upload(filePath, tileBuffer, {
            contentType: mime,
            upsert: true,
          });
          const { data: { publicUrl } } = supabase.storage.from(TILE_UPLOAD_BUCKET).getPublicUrl(filePath);
          const upMs = (performance.now() - up0).toFixed(2);

          let caption: string | null = null;
          const an0 = performance.now();
          if (ANALYZER_INPUT === "url") {
            const { data, error } = await supabase.functions.invoke("MIRA-AGENT-worker-tile-analyzer", {
              body: { tile_url: publicUrl, mime_type: mime },
            });
            if (error) throw error;
            caption = data?.prompt ?? null;
          } else {
            const { encodeBase64 } = await import("https://deno.land/std@0.224.0/encoding/base64.ts");
            const b64 = encodeBase64(tileBuffer);
            const { data, error } = await supabase.functions.invoke("MIRA-AGENT-worker-tile-analyzer", {
              body: { tile_base64: b64, mime_type: mime },
            });
            if (error) throw error;
            caption = data?.prompt ?? null;
          }
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