// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET_OUT = "mira-generations";
const STATE_BUCKET = "mira-agent-compositor-state";

const TILE_SIZE_DEFAULT = 768;
const JPEG_QUALITY = Number(Deno.env.get("COMPOSITOR_JPEG_QUALITY") ?? 85);
const BATCH_SIZE = Number(Deno.env.get("COMPOSITOR_BATCH") ?? 12);
const MAX_FEATHER = Number(Deno.env.get("COMPOSITOR_MAX_FEATHER") ?? 256);

type Pos = { t: any; xs: number; ys: number; err?: number };

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

function normalizeCoords(c:any) {
  if (!c) return null;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { return null; } }
  const x = Number((c as any).x), y = Number((c as any).y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
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
function featherBandsLUT2(tile: Image, ovX: number, ovY: number, n: {left:boolean;right:boolean;top:boolean;bottom:boolean}) {
  const W = tile.width, H = tile.height, bmp = tile.bitmap;
  if (ovX > 0) {
    const Lx = featherLUT(ovX, false), Rx = featherLUT(ovX, true);
    if (n.left)  for (let y=0; y<H; y++) { let a=y*W*4+3;               for (let x=0; x<ovX; x++, a+=4) bmp[a] = (bmp[a]*Lx[x])>>>8; }
    if (n.right) for (let y=0; y<H; y++) { let a=(y*W + (W-ovX))*4+3;   for (let x=0; x<ovX; x++, a+=4) bmp[a] = (bmp[a]*Rx[x])>>>8; }
  }
  if (ovY > 0) {
    const Ty = featherLUT(ovY, false), By = featherLUT(ovY, true);
    if (n.top)    for (let y=0; y<ovY; y++)   { const s=Ty[y]; let a=y*W*4+3;                 for (let x=0; x<W; x++, a+=4) bmp[a]=(bmp[a]*s)>>>8; }
    if (n.bottom) for (let y=H-ovY,i=0; y<H; y++, i++) { const s=By[i]; let a=y*W*4+3;        for (let x=0; x<W; x++, a+=4) bmp[a]=(bmp[a]*s)>>>8; }
  }
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
    if (completeTiles.length === 1) {
        log("Single-tile job detected. Executing fast path, skipping composition.");
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

    const scaleFactor = (claimedJob.upscale_factor || 2.0);
    const finalW = claimedJob.canvas_w;
    const finalH = claimedJob.canvas_h;

    const positions: Pos[] = completeTiles.map(t => ({
        t,
        xs: t.coordinates.x * scaleFactor,
        ys: t.coordinates.y * scaleFactor,
    }));

    const sampleBytes = await downloadTileBytes(supabase, completeTiles[0]);
    const sample = await Image.decode(sampleBytes);
    const expectedTileDim = Math.round(TILE_SIZE * scaleFactor);
    if (sample.width !== expectedTileDim) sample.resize(expectedTileDim, expectedTileDim);
    const actualTileSize = sample.width;

    const xs = positions.map(p => p.xs);
    const ys = positions.map(p => p.ys);

    const EPS = Math.max(2, Math.floor(actualTileSize / 16) - 1);
    function bandsByEps(vals: number[], eps: number) {
      const s = Array.from(new Set(vals.map(v => Math.round(v)))).sort((a,b)=>a-b);
      if (!s.length) return [];
      const centers: number[] = [];
      let cur: number[] = [s[0]];
      for (let i = 1; i < s.length; i++) {
        if (s[i] - cur[cur.length - 1] < eps) cur.push(s[i]);
        else { centers.push(cur.reduce((a,b)=>a+b,0) / cur.length); cur = [s[i]]; }
      }
      centers.push(cur.reduce((a,b)=>a+b,0) / cur.length);
      return centers;
    }

    const xC = bandsByEps(xs, EPS);
    const yC = bandsByEps(ys, EPS);
    if (!xC.length || !yC.length) throw new Error("No band centers detected");

    const xDelta = xC.map((c,i)=> i? (c - xC[i-1]) : actualTileSize);
    const yDelta = yC.map((c,i)=> i? (c - yC[i-1]) : actualTileSize);

    const gridW = (xC[xC.length-1] - xC[0]) + actualTileSize;
    const gridH = (yC[yC.length-1] - yC[0]) + actualTileSize;

    if (gridW > finalW + 1 || gridH > finalH + 1) {
      throw new Error(`Snapped grid exceeds canvas: grid=${gridW}x${gridH} canvas=${finalW}x${finalH}`);
    }

    const x0 = Math.round((finalW - gridW) * 0.5);
    const y0 = Math.round((finalH - gridH) * 1.0);

    log(`[GRID] tile=${actualTileSize} bands=${xC.length}x${yC.length} grid=${gridW}x${gridH} canvas=${finalW}x${finalH} x0=${x0} y0=${y0} xC=${xC.join(',')} yC=${yC.join(',')}`);
    log(`[BANDS] x=${xC.join(',')} y=${yC.join(',')} gapsX=${xC.slice(1).map((c,i)=>c-xC[i]).join(',')} gapsY=${yC.slice(1).map((c,i)=>c-yC[i]).join(',')}`);

    function nearestIdx(bands: number[], v: number) {
      let bi = 0, best = Infinity;
      for (let i=0; i<bands.length; i++) {
        const d = Math.abs(v - bands[i]);
        if (d < best) { best = d; bi = i; }
      }
      return bi;
    }
    const gxOf = (x:number) => nearestIdx(xC, x);
    const gyOf = (y:number) => nearestIdx(yC, y);

    const buckets = new Map<string, Pos[]>();
    for (const p of positions) {
      const k = `${gxOf(p.xs)}:${gyOf(p.ys)}`;
      const arr = buckets.get(k) ?? [];
      if (!buckets.has(k)) buckets.set(k, arr);
      arr.push(p);
    }
    log(`[BUCKETS] unique cells=${buckets.size}, expected=${xC.length * yC.length}`);

    function pick(arr:Pos[], gx:number, gy:number): Pos {
      const xSnap = xC[gx];
      const ySnap = yC[gy];
      arr.sort((a,b)=>{
        const ea = Math.abs(a.xs - xSnap) + Math.abs(a.ys - ySnap);
        const eb = Math.abs(b.xs - xSnap) + Math.abs(b.ys - ySnap);
        if (ea !== eb) return ea - eb;
        const pa = a.t.generated_tile_path || a.t.generated_tile_url || "";
        const pb = b.t.generated_tile_path || b.t.generated_tile_url || "";
        return pa.localeCompare(pb);
      });
      return arr[0];
    }

    const cells: Array<{gx:number; gy:number; p:Pos}> = [];
    for (let gy=0; gy<yC.length; gy++) {
      for (let gx=0; gx<xC.length; gx++) {
        const arr = buckets.get(`${gx}:${gy}`);
        if (!arr || !arr.length) continue;
        cells.push({ gx, gy, p: pick(arr, gx, gy) });
      }
    }

    let canvas: Image;
    if (startIndex === 0) {
      log(`Creating new transparent canvas with dimensions: ${finalW}x${finalH}`);
      if (finalW < 1 || finalH < 1) throw new Error(`Invalid canvas dimensions before creation: ${finalW}x${finalH}`);
      canvas = new Image(finalW, finalH);
    } else {
      log(`Loading canvas state from: ${claimedJob.comp_state_bucket}/${claimedJob.comp_state_path}`);
      const { data: stateBlob } = await retry(() => 
          supabase.storage.from(claimedJob.comp_state_bucket).download(claimedJob.comp_state_path)
          .then(res => { if (res.error) throw res.error; return res; }),
          3, 2000, logPrefix
      );
      canvas = await Image.decode(await stateBlob.arrayBuffer());
      log(`Canvas state loaded successfully. Dimensions: ${canvas.width}x${canvas.height}.`);
    }

    const processed = new Set<string>(
        cells.slice(0, startIndex).map(c => `${c.gx}:${c.gy}`)
    );

    const endIndex = Math.min(startIndex + BATCH_SIZE, cells.length);
    log(`Processing batch from index ${startIndex} to ${endIndex-1}.`);
    for (let i = startIndex; i < endIndex; i++) {
      const { gx, gy, p } = cells[i];
      const t = p.t;
      
      const x = x0 + (xC[gx] - xC[0]);
      const y = y0 + (yC[gy] - yC[0]);

      log(`[Tile ${i}] Processing tile at grid pos (${gx}, ${gy}) and canvas pos (${x}, ${y}).`);
      
      const arr = await retry(() => downloadTileBytes(supabase, t), 3, 2000, `${logPrefix} [Tile ${i}]`);
      log(`[Tile ${i}] Downloaded ${arr.byteLength} bytes.`);
      
      let tile = await Image.decode(arr);
      log(`[Tile ${i}] Decoded image. Original dims: ${tile.width}x${tile.height}.`);

      if (tile.width !== actualTileSize || tile.height !== actualTileSize) {
          log(`[Tile ${i}] Resizing tile to ${actualTileSize}x${actualTileSize}.`);
          tile.resize(actualTileSize, actualTileSize);
      }

      const tileW = tile.width, tileH = tile.height;
      const leftNeighborX = gx > 0 ? x0 + (xC[gx-1] - xC[0]) : 0;
      const topNeighborY  = gy > 0 ? y0 + (yC[gy-1] - yC[0]) : 0;

      const leftOverlap = gx>0 && processed.has(`${gx-1}:${gy}`) ? Math.max(0, (leftNeighborX + actualTileSize) - x) : 0;
      const topOverlap  = gy>0 && processed.has(`${gx}:${gy-1}`) ? Math.max(0, (topNeighborY  + actualTileSize) - y) : 0;

      const leftDelta = gx > 0 ? xDelta[gx] : actualTileSize;
      const topDelta  = gy > 0 ? yDelta[gy] : actualTileSize;
      const leftOverlapExp = Math.max(0, actualTileSize - leftDelta);
      const topOverlapExp  = Math.max(0, actualTileSize - topDelta);

      const ovL = Math.min(leftOverlap, leftOverlapExp, MAX_FEATHER);
      const ovT = Math.min(topOverlap,  topOverlapExp,  MAX_FEATHER);
      
      const BAD_OVERLAP_FACTOR = 1.5;
      const doLeft = ovL > 0 && leftOverlap <= BAD_OVERLAP_FACTOR * leftOverlapExp;
      const doTop  = ovT > 0 && topOverlap  <= BAD_OVERLAP_FACTOR * topOverlapExp;

      if (!doLeft && leftOverlap > 0) log(`[WARN] Disabling left feather for tile ${i} due to excessive overlap (${leftOverlap}px > ${BAD_OVERLAP_FACTOR * leftOverlapExp}px)`);
      if (!doTop && topOverlap > 0) log(`[WARN] Disabling top feather for tile ${i} due to excessive overlap (${topOverlap}px > ${BAD_OVERLAP_FACTOR * topOverlapExp}px)`);

      if (doLeft || doTop) {
        log(`[Tile ${i}] Applying feathering. Left: ${doLeft ? ovL : 0}px, Top: ${doTop ? ovT : 0}px.`);
        featherBandsLUT2(tile, doLeft ? ovL : 0, doTop ? ovT : 0, { left: doLeft, right: false, top: doTop, bottom: false });
      }
      
      log(`[Tile ${i}] Compositing onto canvas at (${x}, ${y}).`);
      canvas.composite(tile, x, y);
      processed.add(`${gx}:${gy}`);
      // @ts-ignore
      tile = null;
      await new Promise(r => setTimeout(r, 0));
    }

    if (endIndex < cells.length) {
      const statePath = `${claimedJob.user_id}/${parent_job_id}/compositor_state.png`;
      log(`Batch complete. Saving checkpoint to ${STATE_BUCKET}/${statePath}`);
      const stateBuffer = await canvas.encode(0);
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
      
      setTimeout(() => {
        supabase.functions.invoke('MIRA-AGENT-compositor-tiled-upscale', {
          body: { parent_job_id: parent_job_id }
        }).catch(err => {
          console.error(`${logPrefix} CRITICAL: Failed to re-invoke self for next batch. The watchdog will need to recover this job. Error:`, err);
        });
      }, 2000);

    } else {
      log("All tiles composited. Finalizing image...");
      const px = finalW * finalH;
      const effQ = px > 64e6 ? Math.min(75, JPEG_QUALITY) : px > 36e6 ? Math.min(80, JPEG_QUALITY) : JPEG_QUALITY;
      log(`Encoding final JPEG (${finalW}x${finalH}) with quality ${effQ}.`);
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