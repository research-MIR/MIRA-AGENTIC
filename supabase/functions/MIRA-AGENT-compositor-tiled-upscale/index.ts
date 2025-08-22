// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET_OUT = "mira-generations";
const STATE_BUCKET = "mira-agent-compositor-state";

const TILE_SIZE_DEFAULT = 768;
const TILE_OVERLAP = 96;
const STEP = TILE_SIZE_DEFAULT - TILE_OVERLAP;
const JPEG_QUALITY = Number(Deno.env.get("COMPOSITOR_JPEG_QUALITY") ?? 85);
const BATCH_SIZE = Number(Deno.env.get("COMPOSITOR_BATCH") ?? 12);
const MAX_FEATHER = Number(Deno.env.get("COMPOSITOR_MAX_FEATHER") ?? 256);

// --- Resilience Helper ---
async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 1000, logPrefix = ""): Promise<T> {
    let lastError: Error | null = null;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            console.warn(`${logPrefix} Attempt ${i + 1}/${retries} failed: ${error.message}. Retrying in ${delay * (i + 1)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1))); // Linear backoff
        }
    }
    throw lastError;
}

const q = (v:number, step:number) => Math.floor((v + step * 0.5) / step);
function normalizeCoords(c:any) {
  if (!c) return null;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { return null; } }
  const x = Number((c as any).x), y = Number((c as any).y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, width: TILE_SIZE_DEFAULT, height: TILE_SIZE_DEFAULT };
}
function isValidTile(t:any) {
  if (!t) return false;
  const c = normalizeCoords(t.coordinates);
  if (!c) return false;
  const hasUrl = !!t.generated_tile_url || (!!t.generated_tile_bucket && !!t.generated_tile_path);
  if (!hasUrl) return false;
  t.coordinates = c;
  return true;
}
const gridX = (t:any) => q(t.coordinates.x, STEP);
const gridY = (t:any) => q(t.coordinates.y, STEP);

function featherLUT(ov: number, invert = false) {
  const lut = new Uint8Array(Math.max(ov, 1));
  if (ov <= 1) { lut[0] = 255; return lut; }
  for (let i = 0; i < ov; i++) {
    let t = i / (ov - 1);
    if (invert) t = 1 - t;
    const s = t * t * (3 - 2 * t);
    lut[i] = (s * 255) | 0;
  }
  return lut;
}
function featherBandsLUT(tile: Image, ov: number, n: {left:boolean;right:boolean;top:boolean;bottom:boolean}) {
  if (ov <= 0) return;
  const W = tile.width, H = tile.height, bmp = tile.bitmap;
  const L = featherLUT(ov, false), R = featherLUT(ov, true);
  if (n.left) for (let y=0; y<H; y++) { let a=(y*W)*4+3; for (let x=0; x<ov; x++, a+=4) bmp[a] = (bmp[a]*L[x])>>>8; }
  if (n.right) for (let y=0; y<H; y++) { let a=(y*W + (W-ov))*4+3; for (let x=0; x<ov; x++, a+=4) bmp[a] = (bmp[a]*R[x])>>>8; }
  if (n.top) for (let y=0; y<ov; y++) { const s=L[y]; let a=(y*W)*4+3; for (let x=0; x<W; x++, a+=4) bmp[a]=(bmp[a]*s)>>>8; }
  if (n.bottom) for (let y=H-ov,i=0; y<H; y++, i++) { const s=R[i]; let a=(y*W)*4+3; for (let x=0; x<W; x++, a+=4) bmp[a]=(bmp[a]*s)>>>8; }
}

async function downloadTileBytes(supabase: SupabaseClient, t: any): Promise<Uint8Array> {
  if (t.generated_tile_bucket && t.generated_tile_path) {
    const { data, error } = await supabase.storage.from(t.generated_tile_bucket).download(t.generated_tile_path);
    if (error) throw new Error(`Storage download failed: ${error.message}`);
    return new Uint8Array(await data.arrayBuffer());
  }
  const res = await fetch(t.generated_tile_url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${t.generated_tile_url}`);
  return new Uint8Array(await res.arrayBuffer());
}

function flattenOpaqueWhite(img: Image): Image {
  const bg = new Image(img.width, img.height);
  bg.fill(0xFFFFFFFF); // Opaque white
  bg.composite(img, 0, 0);
  return bg;
}

serve(async (req) => {
  const { parent_job_id } = await req.json();
  if (!parent_job_id) return new Response("Missing parent_job_id", { status: 400 });

  const logPrefix = `[Compositor][${parent_job_id}]`;
  const log = (m:string)=>console.log(`${logPrefix} ${m}`);
  
  log("Function invoked.");

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { global: { fetch }, auth: { persistSession: false } });
  const workerId = crypto.randomUUID();

  try {
    log(`Attempting to claim job with worker ID: ${workerId}`);
    const { data: claimedJobs, error: claimError } = await retry(() => 
        supabase.rpc('claim_compositor_job', { p_job_id: parent_job_id, p_worker_id: workerId })
        .then(res => { if (res.error) throw res.error; return res; }),
        3, 1000, logPrefix
    );
    
    const claimedJob = claimedJobs?.[0];
    if (!claimedJob) { 
        log("Job is locked by another worker, not ready, or does not exist. Exiting gracefully."); 
        return new Response("ok"); 
    }
    log(`Job claimed successfully. Details: ${JSON.stringify(claimedJob)}`);

    const { data: tilesRaw, error: e2 } = await retry(() => 
        supabase.from("mira_agent_tiled_upscale_tiles").select("coordinates,generated_tile_bucket,generated_tile_path,generated_tile_url,status").eq("parent_job_id", parent_job_id).eq("status", "complete")
        .then(res => { if (res.error) throw res.error; return res; }),
        3, 1000, logPrefix
    );

    const completeTiles = (tilesRaw ?? []).filter(isValidTile);
    log(`Found ${completeTiles.length} valid completed tiles.`);
    if (!completeTiles.length) throw new Error("No valid completed tiles found.");

    // --- SINGLE-TILE FAST PATH ---
    const engine = claimedJob.metadata?.upscaler_engine;
    if (engine?.startsWith('enhancor') && completeTiles.length === 1) {
        log("Single-tile Enhancor job detected. Executing fast path.");
        const singleTile = completeTiles[0];
        let finalUrl = singleTile.generated_tile_url;
        if (!finalUrl) {
            const { data: pub } = supabase.storage.from(singleTile.generated_tile_bucket).getPublicUrl(singleTile.generated_tile_path);
            finalUrl = pub.publicUrl;
        }

        if (!finalUrl) {
            throw new Error("Single tile is missing its final URL.");
        }

        await retry(() => 
            supabase.from("mira_agent_tiled_upscale_jobs").update({ 
                status: "complete", 
                final_image_url: finalUrl, 
                comp_next_index: 1,
                comp_state_path: null, 
                comp_state_bucket: null, 
                compositor_worker_id: null, 
                comp_lease_expires_at: null 
            }).eq("id", parent_job_id)
            .then(res => { if (res.error) throw res.error; return res; }),
            3, 1000, logPrefix
        );
        log(`Fast path complete. Final URL set to: ${finalUrl}`);
        return new Response("ok");
    }
    // --- END FAST PATH ---

    completeTiles.sort((a,b) => gridY(a) - gridY(b) || gridX(a) - gridX(b));

    const startIndex = claimedJob.comp_next_index || 0;
    log(`Processing starts at index: ${startIndex}. Batch size: ${BATCH_SIZE}.`);
    if (startIndex >= completeTiles.length) { log("All tiles already processed. Moving to finalization."); }

    log(`Validating job parameters: upscale_factor=${claimedJob.upscale_factor}, canvas_w=${claimedJob.canvas_w}, canvas_h=${claimedJob.canvas_h}`);
    
    const TILE_SIZE_FROM_META = claimedJob.metadata?.tile_size;
    let TILE_SIZE = TILE_SIZE_DEFAULT;
    let isFullSizeMode = false;
    let originalW = 0;
    let originalH = 0;

    if (typeof TILE_SIZE_FROM_META === 'number') {
        TILE_SIZE = TILE_SIZE_FROM_META;
    } else if (TILE_SIZE_FROM_META === 'full_size') {
        isFullSizeMode = true;
        originalW = Math.round(claimedJob.canvas_w / claimedJob.upscale_factor);
        originalH = Math.round(claimedJob.canvas_h / claimedJob.upscale_factor);
        TILE_SIZE = Math.max(originalW, originalH);
    }
    log(`Using TILE_SIZE: ${TILE_SIZE} based on job metadata. Full size mode: ${isFullSizeMode}`);

    const actualTileSize = TILE_SIZE * (claimedJob.upscale_factor || 2.0);
    const scaleFactor = actualTileSize / TILE_SIZE;
    const finalW = claimedJob.canvas_w;
    const finalH = claimedJob.canvas_h;
    const ovScaled = Math.min(Math.max(1, Math.round(TILE_OVERLAP * scaleFactor)), MAX_FEATHER, actualTileSize - 1);
    log(`Calculated parameters: actualTileSize=${actualTileSize}, scaleFactor=${scaleFactor}, finalW=${finalW}, finalH=${finalH}, ovScaled=${ovScaled}`);

    let canvas: Image;
    if (startIndex === 0) {
      log(`Creating new canvas with dimensions: ${finalW}x${finalH}`);
      if (finalW < 1 || finalH < 1) throw new Error(`Invalid canvas dimensions before creation: ${finalW}x${finalH}`);
      canvas = new Image(finalW, finalH);
      canvas.fill(0xFFFFFFFF); // FIX 1: Start with an opaque white canvas
    } else {
      log(`Loading canvas state from: ${claimedJob.comp_state_bucket}/${claimedJob.comp_state_path}`);
      const { data: stateBlob, error: downloadError } = await retry(() => 
          supabase.storage.from(claimedJob.comp_state_bucket).download(claimedJob.comp_state_path)
          .then(res => { if (res.error) throw res.error; return res; }),
          3, 2000, logPrefix
      );
      const loadedCanvas = await Image.decode(await stateBlob.arrayBuffer());
      log(`Canvas state loaded successfully. Dimensions: ${loadedCanvas.width}x${loadedCanvas.height}. Re-opaquing...`);
      // FIX 2: When resuming from a PNG state, re-opaque it
      canvas = flattenOpaqueWhite(loadedCanvas);
    }

    const occupy = new Set<string>();
    for (const t of completeTiles) occupy.add(`${gridX(t)}:${gridY(t)}`);
    const hasAt = (gx:number,gy:number)=>occupy.has(`${gx}:${gy}`);

    const endIndex = Math.min(startIndex + BATCH_SIZE, completeTiles.length);
    log(`Processing batch from index ${startIndex} to ${endIndex-1}.`);
    for (let i = startIndex; i < endIndex; i++) {
      const t = completeTiles[i];
      const gx = gridX(t), gy = gridY(t);
      log(`[Tile ${i}] Processing tile at grid pos (${gx}, ${gy}).`);
      
      const arr = await retry(() => downloadTileBytes(supabase, t), 3, 2000, `${logPrefix} [Tile ${i}]`);
      log(`[Tile ${i}] Downloaded ${arr.byteLength} bytes.`);
      
      let tile = await Image.decode(arr);
      log(`[Tile ${i}] Decoded image. Original dims: ${tile.width}x${tile.height}.`);

      if (isFullSizeMode) {
          const expectedW = Math.round(originalW * claimedJob.upscale_factor);
          const expectedH = Math.round(originalH * claimedJob.upscale_factor);
          log(`[Tile ${i}] Full size mode. Expected dims: ${expectedW}x${expectedH}.`);
          if (tile.width !== expectedW || tile.height !== expectedH) {
              log(`[Tile ${i}] Resizing tile to ${expectedW}x${expectedH}.`);
              tile.resize(expectedW, expectedH);
          }
      } else {
          log(`[Tile ${i}] Tiled mode. Expected square dims: ${actualTileSize}x${actualTileSize}.`);
          if (tile.width !== actualTileSize || tile.height !== actualTileSize) {
              log(`[Tile ${i}] Resizing tile to ${actualTileSize}x${actualTileSize}.`);
              tile.resize(actualTileSize, actualTileSize);
          }
      }

      const x = Math.round(t.coordinates.x * scaleFactor);
      const y = Math.round(t.coordinates.y * scaleFactor);
      const n = { left: hasAt(gx-1,gy), right: hasAt(gx+1,gy), top: hasAt(gx,gy-1), bottom: hasAt(gx,gy+1) };
      log(`[Tile ${i}] Feather neighbors: ${JSON.stringify(n)}`);
      
      const incoming = { left: n.left, right: false, top: n.top, bottom: false };
      if (incoming.left || incoming.top) {
        log(`[Tile ${i}] Applying feathering with overlap ${ovScaled}.`);
        featherBandsLUT(tile, ovScaled, incoming);
      }
      
      log(`[Tile ${i}] Compositing onto canvas at (${x}, ${y}).`);
      canvas.composite(tile, x, y);
      // @ts-ignore
      tile = null;
      await new Promise(r => setTimeout(r, 0));
    }

    if (endIndex < completeTiles.length) {
      const statePath = `${claimedJob.user_id}/${parent_job_id}/compositor_state.png`;
      log(`Batch complete. Saving checkpoint to ${STATE_BUCKET}/${statePath}`);
      // FIX 3: Flatten before saving checkpoint
      const opaqueForState = flattenOpaqueWhite(canvas);
      const stateBuffer = await opaqueForState.encode(0); // PNG encoding
      await retry(() => 
          supabase.storage.from(STATE_BUCKET).upload(statePath, stateBuffer, { contentType: 'image/png', upsert: true })
          .then(res => { if (res.error) throw res.error; return res; }),
          3, 1000, logPrefix
      );
      await retry(() => 
          supabase.from("mira_agent_tiled_upscale_jobs").update({ comp_next_index: endIndex, comp_state_bucket: STATE_BUCKET, comp_state_path: statePath, comp_lease_expires_at: new Date(Date.now() + 1 * 60000).toISOString() }).eq("id", parent_job_id)
          .then(res => { if (res.error) throw res.error; return res; }),
          3, 1000, logPrefix
      );
      log(`Checkpoint saved. Next index is ${endIndex}. Re-invoking self to continue.`);
      
      // Asynchronously invoke self to process the next batch AFTER a short delay
      setTimeout(() => {
        supabase.functions.invoke('MIRA-AGENT-compositor-tiled-upscale', {
          body: { parent_job_id: parent_job_id }
        }).catch(err => {
          console.error(`${logPrefix} CRITICAL: Failed to re-invoke self for next batch. The watchdog will need to recover this job. Error:`, err);
        });
      }, 2000); // 2-second delay

    } else {
      log("All tiles composited. Finalizing image...");
      const px = finalW * finalH;
      const effQ = px > 64e6 ? Math.min(75, JPEG_QUALITY) : px > 36e6 ? Math.min(80, JPEG_QUALITY) : JPEG_QUALITY;
      log(`Encoding final JPEG (${finalW}x${finalH}) with quality ${effQ}.`);
      // FIX 3: Flatten before final JPEG encode
      const finalOpaque = flattenOpaqueWhite(canvas);
      const outBytes = await finalOpaque.encodeJPEG(effQ);
      const outPath = `${claimedJob.user_id}/${parent_job_id}/tiled-upscale-final-${finalW}x${finalH}.jpg`;
      log(`Uploading final image to ${BUCKET_OUT}/${outPath}`);
      await retry(() => 
          supabase.storage.from(BUCKET_OUT).upload(outPath, outBytes, { contentType: "image/jpeg", upsert: true })
          .then(res => { if (res.error) throw res.error; return res; }),
          3, 2000, logPrefix
      );
      const { data: pub } = supabase.storage.from(BUCKET_OUT).getPublicUrl(outPath);
      await retry(() => 
          supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "complete", final_image_url: pub.publicUrl, comp_next_index: endIndex, comp_state_path: null, comp_state_bucket: null, compositor_worker_id: null, comp_lease_expires_at: null }).eq("id", parent_job_id)
          .then(res => { if (res.error) throw res.error; return res; }),
          3, 1000, logPrefix
      );
      log(`Compositing complete. Final URL: ${pub.publicUrl}`);
      log(`Cleaning up state file...`);
      await supabase.storage.from(STATE_BUCKET).remove([`${claimedJob.user_id}/${parent_job_id}/compositor_state.png`]);
    }
    return new Response("ok");
  } catch (err:any) {
    console.error(`${logPrefix} FATAL ERROR:`, err);
    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "failed", error_message: `Compositor failed: ${err.message}` }).eq("id", parent_job_id);
    return new Response(String(err?.message ?? err), { status: 500 });
  }
});