// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET_OUT = "mira-generations";

const JPEG_QUALITY = Number(Deno.env.get("COMPOSITOR_JPEG_QUALITY") ?? 90);
const MEM_HARD_LIMIT_MB = Number(Deno.env.get("COMPOSITOR_MEM_LIMIT_MB") ?? 360);

type Tile = {
  tile_index: number;
  coordinates: { x: number; y: number; width: number; height: number };
  generated_tile_url: string;
  status: "complete" | string;
};

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  global: { fetch }, auth: { persistSession: false }
});

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

function buildRamp(n: number, invert = false): Float32Array {
  const r = new Float32Array(n);
  if (n <= 0) return r.fill(1);
  for (let i = 0; i < n; i++) {
    let t = i / (n - 1);
    t = t * t * (3 - 2 * t); // smoothstep
    r[i] = invert ? 1 - t : t;
  }
  return r;
}

function ramps1D(size: number, ov: number) {
  const L = buildRamp(ov, false), R = buildRamp(ov, true);
  const left = new Float32Array(size), right = new Float32Array(size);
  for (let x=0; x<size; x++) {
    left[x]  = x < ov ? L[x] : 1;
    right[x] = x >= size-ov ? R[x-(size-ov)] : 1;
  }
  const mk = (hasNeg:boolean, hasPos:boolean) => {
    const v = new Float32Array(size);
    for (let x=0; x<size; x++) {
      let g = 1;
      if (hasNeg) g = Math.min(g, left[x]);
      if (hasPos) g = Math.min(g, right[x]);
      v[x] = g;
    }
    return v;
  };
  return { h00: mk(false,false), h10: mk(true,false), h01: mk(false,true), h11: mk(true,true) };
}

function rampsY(size:number, ov:number) {
  const T = buildRamp(ov,false), B = buildRamp(ov,true);
  const top = new Float32Array(size), bot = new Float32Array(size);
  for (let y=0; y<size; y++) {
    top[y] = y < ov ? T[y] : 1;
    bot[y] = y >= size-ov ? B[y-(size-ov)] : 1;
  }
  const mk = (hasNeg:boolean, hasPos:boolean) => {
    const v = new Float32Array(size);
    for (let y=0; y<size; y++) {
      let g = 1;
      if (hasNeg) g = Math.min(g, top[y]);
      if (hasPos) g = Math.min(g, bot[y]);
      v[y] = g;
    }
    return v;
  };
  return { v00: mk(false,false), v10: mk(true,false), v01: mk(false,true), v11: mk(true,true) };
}

function blendWeighted(canvas: Image, tile: Image, x0: number, y0: number, hx: Float32Array, vy: Float32Array) {
  const cb = canvas.bitmap, tb = tile.bitmap;
  const W = canvas.width, tw = tile.width, th = tile.height;

  for (let y=0; y<th; y++) {
    const wy = vy[y];
    const cy = (y0 + y) * W;
    const ty = y * tw;
    for (let x=0; x<tw; x++) {
      const w = hx[x] * wy;
      if (w <= 0) continue;

      const cidx = ((cy + (x0 + x)) << 2);
      const tidx = ((ty + x) << 2);

      const wOld = cb[cidx+3] / 255;
      const wNew = Math.min(1, wOld + w);
      const scaleOld = wOld > 0 ? (wOld / wNew) : 0;
      const scaleAdd = w / wNew;

      cb[cidx  ] = Math.round(cb[cidx  ] * scaleOld + tb[tidx  ] * scaleAdd);
      cb[cidx+1] = Math.round(cb[cidx+1] * scaleOld + tb[tidx+1] * scaleAdd);
      cb[cidx+2] = Math.round(cb[cidx+2] * scaleOld + tb[tidx+2] * scaleAdd);
      cb[cidx+3] = Math.round(wNew * 255);   // store weight sum
    }
  }
}

async function fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function run(parent_job_id: string) {
  const logPrefix = `[Compositor][${parent_job_id}]`;
  console.log(`${logPrefix} Starting run.`);

  const { data: parentRow, error: e1 } = await supabase
    .from("mira_agent_tiled_upscale_jobs")
    .select("id,user_id,source_image_url,status,final_image_url,upscale_factor")
    .eq("id", parent_job_id)
    .single();
  if (e1 || !parentRow) throw new Error(`Parent not found: ${e1?.message}`);

  if (parentRow.final_image_url) {
    console.log(`${logPrefix} Job already has a final image URL. Exiting.`);
    return;
  }

  const { data: tiles, error: e2 } = await supabase
    .from("mira_agent_tiled_upscale_tiles")
    .select("tile_index,coordinates,generated_tile_url,status")
    .eq("parent_job_id", parent_job_id)
    .order("tile_index", { ascending: true });
  if (e2) throw new Error(e2.message);

  const completeTiles: Tile[] = (tiles ?? []).filter(t => t.status === "complete");
  if (!completeTiles.length) throw new Error("No completed tiles found for this job.");

  const firstTileBytes = await fetchBytes(completeTiles[0].generated_tile_url, new AbortController().signal);
  const firstTileImage = await Image.decode(firstTileBytes);
  const actualTileSize = firstTileImage.width;
  const scaleFactor = actualTileSize / TILE_SIZE;
  console.log(`${logPrefix} Detected upscale factor of ${scaleFactor}x (Tiles are ${actualTileSize}px)`);

  const { bucket, path } = parseStorageURL(parentRow.source_image_url);
  console.log(`${logPrefix} Downloading source image from bucket: ${bucket}, path: ${path}`);
  const { data: sourceBlob, error: dlError } = await supabase.storage.from(bucket).download(path);
  if (dlError) throw new Error(`Failed to download original source image: ${dlError.message}`);
  
  const originalImage = await Image.decode(await sourceBlob.arrayBuffer());
  
  const intermediateW = Math.round(originalImage.width * parentRow.upscale_factor);
  originalImage.resize(intermediateW, Image.RESIZE_AUTO, Image.RESIZE_BICUBIC);
  
  const finalW = Math.round(originalImage.width * scaleFactor);
  const finalH = Math.round(originalImage.height * scaleFactor);
  console.log(`${logPrefix} Final canvas dimensions will be ${finalW}x${finalH}`);

  const estMB = (finalW * finalH * 4 * 2 + 8 * actualTileSize * 4) / (1024 * 1024);
  if (estMB > MEM_HARD_LIMIT_MB) {
    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "failed", error_message: `Estimated RAM ${estMB.toFixed(1)}MB exceeds limit ${MEM_HARD_LIMIT_MB}MB.` }).eq("id", parent_job_id);
    throw new Error(`Refused: est ${estMB.toFixed(1)} MB > limit ${MEM_HARD_LIMIT_MB}`);
  }

  const canvas = new Image(finalW, finalH); // Starts as transparent black
  console.log(`${logPrefix} Created empty canvas for normalized blending.`);

  // --- New Dynamic Step & Overlap Calculation ---
  const xs = [...new Set(completeTiles.map(t => t.coordinates.x))].sort((a,b)=>a-b);
  const ys = [...new Set(completeTiles.map(t => t.coordinates.y))].sort((a,b)=>a-b);
  const dx = xs.length > 1 ? Math.min(...xs.slice(1).map((v,i)=>v - xs[i])) : 0;
  const dy = ys.length > 1 ? Math.min(...ys.slice(1).map((v,i)=>v - ys[i])) : 0;
  const stepX = Math.round(dx * scaleFactor);
  const stepY = Math.round(dy * scaleFactor);
  const ovX = Math.max(0, Math.min(actualTileSize >> 1, actualTileSize - stepX));
  const ovY = Math.max(0, Math.min(actualTileSize >> 1, actualTileSize - stepY));
  console.log(`${logPrefix} Inferred scaled steps: {x: ${stepX}, y: ${stepY}}. Overlaps: {x: ${ovX}, y: ${ovY}}`);

  const HR = ramps1D(actualTileSize, ovX);
  const VR = rampsY(actualTileSize, ovY);

  // --- New Robust Neighbor Lookup ---
  const EPSX = Math.max(1, Math.floor(stepX/8)), EPSY = Math.max(1, Math.floor(stepY/8));
  const key = (x:number,y:number)=> `${Math.round(x/EPSX)},${Math.round(y/EPSY)}`;
  const idx = new Set(completeTiles.map(t => key(Math.round(t.coordinates.x*scaleFactor), Math.round(t.coordinates.y*scaleFactor))));
  function flags(x:number,y:number) {
    const k = (xx:number,yy:number)=> idx.has(key(xx,yy));
    return {
      left:   k(x - stepX, y),
      right:  k(x + stepX, y),
      top:    k(x, y - stepY),
      bottom: k(x, y + stepY),
    };
  }

  for (const t of completeTiles) {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 25_000);
    const bytes = await fetchBytes(t.generated_tile_url, ctl.signal);
    clearTimeout(timeout);

    let tile: Image | null = await Image.decode(bytes);
    console.log(`${logPrefix} Processing Tile #${t.tile_index} | Coords: {x:${t.coordinates.x}, y:${t.coordinates.y}} | Decoded Size: ${tile.width}x${tile.height}`);
    
    if (tile.width !== actualTileSize) {
        console.warn(`${logPrefix} Tile #${t.tile_index} has unexpected size ${tile.width}x${tile.height}. Resizing to ${actualTileSize}px.`);
        tile.resize(actualTileSize, actualTileSize, Image.RESIZE_BICUBIC);
    }

    const scaledX = Math.round(t.coordinates.x * scaleFactor);
    const scaledY = Math.round(t.coordinates.y * scaleFactor);
    const f = flags(scaledX, scaledY);
    const hx = HR[`h${f.left?1:0}${f.right?1:0}` as const];
    const vy = VR[`v${f.top?1:0}${f.bottom?1:0}` as const];

    blendWeighted(canvas, tile, scaledX, scaledY, hx, vy);
    
    tile = null; // Help GC
  }

  // Force full opacity before encoding to JPEG
  for (let i = 0; i < canvas.bitmap.length; i += 4) canvas.bitmap[i + 3] = 255;

  const jpeg = await canvas.encodeJPEG(JPEG_QUALITY);
  const outPath = `${parentRow.user_id}/${parent_job_id}/tiled-upscale-final-${finalW}x${finalH}.jpg`;
  await supabase.storage.from(BUCKET_OUT).upload(outPath, jpeg, { contentType: "image/jpeg", upsert: true });
  const { data: pub } = supabase.storage.from(BUCKET_OUT).getPublicUrl(outPath);

  await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "complete", final_image_url: pub.publicUrl }).eq("id", parent_job_id);
  console.log(`${logPrefix} Compositing complete. Final URL: ${pub.publicUrl}`);
}

serve(async (req) => {
  const { parent_job_id } = await req.json();
  if (!parent_job_id) return new Response("Missing parent_job_id", { status: 400 });
  try {
    await run(parent_job_id);
    return new Response("ok");
  } catch (err) {
    console.error(`[Compositor][${parent_job_id}] FATAL ERROR:`, err);
    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "failed", error_message: `Compositor failed: ${err.message}` }).eq("id", parent_job_id);
    return new Response(String(err?.message ?? err), { status: 500 });
  }
});