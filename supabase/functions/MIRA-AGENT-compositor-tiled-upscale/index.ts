// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET_OUT = "mira-generations";

const TILE_SIZE = 1024;
const TILE_OVERLAP = 264;
const STEP = TILE_SIZE - TILE_OVERLAP;
const JPEG_QUALITY = Number(Deno.env.get("COMPOSITOR_JPEG_QUALITY") ?? 85);
const MEM_HARD_LIMIT_MB = Number(Deno.env.get("COMPOSITOR_MEM_LIMIT_MB") ?? 360);
const MAX_FEATHER = Number(Deno.env.get("COMPOSITOR_MAX_FEATHER") ?? 256);
const MAX_PIXELS = Number(Deno.env.get("COMPOSITOR_MAX_PX") ?? 80e6);
const OUTPUT_FORMAT = (Deno.env.get("COMPOSITOR_OUTPUT") ?? "jpeg").toLowerCase();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------- helpers: safe coords, grid, URL cache ----------
const q = (v:number, step:number) => Math.floor((v + step * 0.5) / step);

function normalizeCoords(c:any) {
  if (!c) return null;
  if (typeof c === "string") {
    try { c = JSON.parse(c); } catch { return null; }
  }
  const x = Number((c as any).x), y = Number((c as any).y);
  const w = Number((c as any).width ?? TILE_SIZE);
  const h = Number((c as any).height ?? TILE_SIZE);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, width: w, height: h };
}
function isValidTile(t:any) {
  if (!t) return false;
  const c = normalizeCoords(t.coordinates);
  if (!c) return false;
  const hasUrl = !!t.generated_tile_url || (!!t.generated_tile_bucket && !!t.generated_tile_path);
  if (!hasUrl) return false;
  t.coordinates = c; // mutate into normalized
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
  // left
  if (n.left) for (let y=0; y<H; y++) { let a=(y*W)*4+3; for (let x=0; x<ov; x++, a+=4) bmp[a] = (bmp[a]*L[x])>>>8; }
  // right
  if (n.right) for (let y=0; y<H; y++) { let a=(y*W + (W-ov))*4+3; for (let x=0; x<ov; x++, a+=4) bmp[a] = (bmp[a]*R[x])>>>8; }
  // top
  if (n.top) for (let y=0; y<ov; y++) { const s=L[y]; let a=(y*W)*4+3; for (let x=0; x<W; x++, a+=4) bmp[a]=(bmp[a]*s)>>>8; }
  // bottom
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

async function run(supabase: SupabaseClient, parent_job_id: string) {
  const log = (m:string)=>console.log(`[Compositor][${parent_job_id}] ${m}`);

  const { data: parent, error: e1 } = await supabase
    .from("mira_agent_tiled_upscale_jobs")
    .select("id,user_id,final_image_url")
    .eq("id", parent_job_id).single();
  if (e1 || !parent) throw new Error(`Parent not found: ${e1?.message}`);
  if (parent.final_image_url) { log("Already complete."); return; }

  const { data: tilesRaw, error: e2 } = await supabase
    .from("mira_agent_tiled_upscale_tiles")
    .select("tile_index,coordinates,generated_tile_bucket,generated_tile_path,generated_tile_url,status")
    .eq("parent_job_id", parent_job_id)
    .eq("status", "complete");
  if (e2) throw new Error(e2.message);

  const completeTiles = (tilesRaw ?? []).filter(isValidTile);
  if (!completeTiles.length) throw new Error("No valid completed tiles with coordinates and image refs.");
  completeTiles.sort((a,b) => gridY(a) - gridY(b) || gridX(a) - gridX(b));

  const firstBytes = await downloadTileBytes(supabase, completeTiles[0]);
  const firstTileImage = await Image.decode(firstBytes);
  const actualTileSize = firstTileImage.width;
  const scaleFactor = actualTileSize / TILE_SIZE;
  log(`Detected upscale factor ${scaleFactor}x (tile ${actualTileSize}px)`);

  const maxX = Math.max(...completeTiles.map(t => t.coordinates.x));
  const maxY = Math.max(...completeTiles.map(t => t.coordinates.y));
  const finalW = Math.round((maxX + TILE_SIZE) * scaleFactor);
  const finalH = Math.round((maxY + TILE_SIZE) * scaleFactor);
  log(`Final canvas ${finalW}x${finalH}`);

  if ((finalW * finalH) > MAX_PIXELS) {
    throw new Error(`Refused: Final image dimensions ${finalW}x${finalH} exceed the maximum pixel limit of ${MAX_PIXELS}.`);
  }

  const ovScaled = Math.min(Math.max(1, Math.round(TILE_OVERLAP * scaleFactor)), MAX_FEATHER, actualTileSize - 1);
  const stepScaled = actualTileSize - ovScaled;
  if (stepScaled <= 0) throw new Error(`Invalid stepScaled ${stepScaled}; check TILE_OVERLAP vs tile size.`);

  const bytesCanvas = finalW * finalH * 4;
  const bytesTile = actualTileSize * actualTileSize * 4;
  const estMB = (bytesCanvas + bytesTile)/(1024*1024) + 32;
  if (estMB > MEM_HARD_LIMIT_MB) {
    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "failed", error_message: `Estimated RAM ${estMB.toFixed(1)}MB > ${MEM_HARD_LIMIT_MB}MB` }).eq("id", parent_job_id);
    throw new Error(`Refused: est ${estMB.toFixed(1)} MB > limit ${MEM_HARD_LIMIT_MB}`);
  }

  const canvas = new Image(finalW, finalH);

  const occupy = new Set<string>();
  const k = (gx:number,gy:number)=>`${gx}:${gy}`;
  for (const t of completeTiles) occupy.add(k(gridX(t), gridY(t)));
  const hasAt = (gx:number,gy:number)=>occupy.has(k(gx,gy));

  for (const t of completeTiles) {
    const arr = await downloadTileBytes(supabase, t);
    let tile = await Image.decode(arr);
    if (tile.width !== actualTileSize || tile.height !== actualTileSize) {
        const fixed = new Image(actualTileSize, actualTileSize);
        const dx = Math.floor((actualTileSize - tile.width) / 2);
        const dy = Math.floor((actualTileSize - tile.height) / 2);
        fixed.composite(tile, dx, dy);
        tile = fixed;
    }

    const gx = gridX(t), gy = gridY(t);
    const x = gx * stepScaled;
    const y = gy * stepScaled;

    const n = { left: hasAt(gx-1,gy), right: hasAt(gx+1,gy), top: hasAt(gx,gy-1), bottom: hasAt(gx,gy+1) };
    const incoming = { left: n.left, right: false, top: n.top, bottom: false };
    if (incoming.left || incoming.top) featherBandsLUT(tile, ovScaled, incoming);

    canvas.composite(tile, x, y);
    // @ts-ignore
    tile = null;

    await new Promise(r => setTimeout(r, 0));
  }

  const px = finalW * finalH;
  const effQ = px > 64e6 ? Math.min(70, JPEG_QUALITY) : px > 36e6 ? Math.min(78, JPEG_QUALITY) : JPEG_QUALITY;
  
  let outBytes: Uint8Array;
  let mimeType: string;
  let fileExtension: string;

  if (OUTPUT_FORMAT === "webp") {
    outBytes = await canvas.encode(2, Math.min(80, effQ));
    mimeType = "image/webp";
    fileExtension = "webp";
  } else {
    outBytes = await canvas.encodeJPEG(effQ);
    mimeType = "image/jpeg";
    fileExtension = "jpg";
  }

  const outPath = `${parent.user_id}/${parent_job_id}/tiled-upscale-final-${finalW}x${finalH}.${fileExtension}`;
  await supabase.storage.from(BUCKET_OUT).upload(outPath, outBytes, { contentType: mimeType, upsert: true });
  const { data: pub } = supabase.storage.from(BUCKET_OUT).getPublicUrl(outPath);
  await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "complete", final_image_url: pub.publicUrl }).eq("id", parent_job_id);
  log(`Compositing complete. Final URL: ${pub.publicUrl}`);
}

serve(async (req) => {
  const { parent_job_id } = await req.json();
  if (!parent_job_id) return new Response("Missing parent_job_id", { status: 400 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { global: { fetch }, auth: { persistSession: false } });
  try {
    await run(supabase, parent_job_id);
    return new Response("ok");
  } catch (err:any) {
    console.error(`[Compositor][${parent_job_id}] FATAL ERROR:`, err);
    await supabase.from("mira_agent_tiled_upscale_jobs")
      .update({ status: "failed", error_message: `Compositor failed: ${err.message}` })
      .eq("id", parent_job_id);
    return new Response(String(err?.message ?? err), { status: 500 });
  }
});