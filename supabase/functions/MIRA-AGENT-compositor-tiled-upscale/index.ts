// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET_OUT = "mira-agent-generations";

const TILE_SIZE = 1024;
const TILE_OVERLAP = 264;
const STEP = TILE_SIZE - TILE_OVERLAP;

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

function ramps1D(size = TILE_SIZE, ov = TILE_OVERLAP) {
  const left = new Float32Array(size);
  const right = new Float32Array(size);
  const L = buildRamp(ov, false);
  const R = buildRamp(ov, true);

  for (let x = 0; x < size; x++) {
    if (x < ov) left[x] = L[x]; else left[x] = 1;
    if (x >= size - ov) right[x] = R[x - (size - ov)]; else right[x] = 1;
  }

  function variant(hasLeft: boolean, hasRight: boolean) {
    const v = new Float32Array(size);
    for (let x = 0; x < size; x++) {
      let g = 1;
      if (hasLeft) g = Math.min(g, left[x]);
      if (hasRight) g = Math.min(g, right[x]);
      v[x] = g;
    }
    return v;
  }

  return {
    h00: variant(false, false), h10: variant(true, false),
    h01: variant(false, true), h11: variant(true, true),
  };
}

function ramps2D() {
  const H = ramps1D();
  const V_ramps: any = {};

  function buildV(hasTop: boolean, hasBottom: boolean): Float32Array {
    const arr = new Float32Array(TILE_SIZE);
    const top = buildRamp(TILE_OVERLAP, false);
    const bottom = buildRamp(TILE_OVERLAP, true);
    for (let y = 0; y < TILE_SIZE; y++) {
      let g = 1;
      if (hasTop) g = Math.min(g, y < TILE_OVERLAP ? top[y] : 1);
      if (hasBottom) g = Math.min(g, y >= TILE_SIZE - TILE_OVERLAP ? bottom[y - (TILE_SIZE - TILE_OVERLAP)] : 1);
      arr[y] = g;
    }
    return arr;
  }
  V_ramps.v00 = buildV(false, false); V_ramps.v10 = buildV(true, false);
  V_ramps.v01 = buildV(false, true); V_ramps.v11 = buildV(true, true);
  return { ...H, ...V_ramps };
}

function pick1D(R: any, hasNeg: boolean, hasPos: boolean, axis: "h" | "v") {
  const key = `${axis}${hasNeg ? '1' : '0'}${hasPos ? '1' : '0'}`;
  return R[key];
}

function applyFeatherAlpha(tile: Image, hx: Float32Array, vy: Float32Array) {
  const bmp = tile.bitmap;
  let i = 0;
  for (let y = 0; y < TILE_SIZE; y++) {
    const gy = vy[y];
    for (let x = 0; x < TILE_SIZE; x++) {
      const gx = hx[x];
      const aIdx = i + 3;
      bmp[aIdx] = Math.round(bmp[aIdx] * (gx * gy));
      i += 4;
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

  const { bucket, path } = parseStorageURL(parentRow.source_image_url);
  console.log(`${logPrefix} Downloading source image from bucket: ${bucket}, path: ${path}`);
  const { data: sourceBlob, error: dlError } = await supabase.storage.from(bucket).download(path);
  if (dlError) throw new Error(`Failed to download original source image: ${dlError.message}`);
  
  const originalImage = await Image.decode(await sourceBlob.arrayBuffer());
  
  // Upscale the base image to get the final canvas dimensions
  const targetW = Math.round(originalImage.width * parentRow.upscale_factor);
  originalImage.resize(targetW, Image.RESIZE_AUTO, Image.RESIZE_BICUBIC);
  const W = originalImage.width;
  const H = originalImage.height;
  console.log(`${logPrefix} Final canvas dimensions will be ${W}x${H}`);

  const estMB = (W * H * 4 + TILE_SIZE * TILE_SIZE * 4 + 8 * TILE_SIZE * 4) / (1024 * 1024);
  if (estMB > MEM_HARD_LIMIT_MB) {
    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "failed", error_message: `Estimated RAM ${estMB.toFixed(1)}MB exceeds limit ${MEM_HARD_LIMIT_MB}MB.` }).eq("id", parent_job_id);
    throw new Error(`Refused: est ${estMB.toFixed(1)} MB > limit ${MEM_HARD_LIMIT_MB}`);
  }

  const canvas = new Image(W, H);
  const R = ramps2D();

  function neighborFlags(t: Tile) {
    const { x, y } = t.coordinates;
    const left = completeTiles.some(o => o.coordinates.y === y && o.coordinates.x === x - STEP);
    const right = completeTiles.some(o => o.coordinates.y === y && o.coordinates.x === x + STEP);
    const top = completeTiles.some(o => o.coordinates.x === x && o.coordinates.y === y - STEP);
    const bottom = completeTiles.some(o => o.coordinates.x === x && o.coordinates.y === y + STEP);
    return { left, right, top, bottom };
  }

  for (const t of completeTiles) {
    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 25_000);
    const bytes = await fetchBytes(t.generated_tile_url, ctl.signal);
    clearTimeout(timeout);

    let tile: Image | null = await Image.decode(bytes);
    const n = neighborFlags(t);
    const hx = pick1D(R, n.left, n.right, "h");
    const vy = pick1D(R, n.top, n.bottom, "v");
    applyFeatherAlpha(tile, hx, vy);

    canvas.composite(tile, t.coordinates.x, t.coordinates.y);
    tile = null; // Help GC
  }

  const jpeg = await canvas.encodeJPEG(JPEG_QUALITY);
  const outPath = `${parentRow.user_id}/${parent_job_id}/tiled-upscale-final-${W}x${H}.jpg`;
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