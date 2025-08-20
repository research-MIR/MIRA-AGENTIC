// deno-lint-ignore-file no-explicit-any
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET_OUT = "mira-generations";
const STATE_BUCKET = "mira-agent-compositor-state";

const TILE_SIZE = 1024;
const TILE_OVERLAP = 264;
const STEP = TILE_SIZE - TILE_OVERLAP;
const JPEG_QUALITY = Number(Deno.env.get("COMPOSITOR_JPEG_QUALITY") ?? 85);
const MEM_HARD_LIMIT_MB = Number(Deno.env.get("COMPOSITOR_MEM_LIMIT_MB") ?? 360);
const MAX_FEATHER = Number(Deno.env.get("COMPOSITOR_MAX_FEATHER") ?? 256);
const MAX_PIXELS = Number(Deno.env.get("COMPOSITOR_MAX_PX") ?? 80e6);
const BATCH_SIZE = Number(Deno.env.get("COMPOSITOR_BATCH") ?? 12);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const q = (v:number, step:number) => Math.floor((v + step * 0.5) / step);
function normalizeCoords(c:any) {
  if (!c) return null;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { return null; } }
  const x = Number((c as any).x), y = Number((c as any).y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, width: TILE_SIZE, height: TILE_SIZE };
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

serve(async (req) => {
  const { parent_job_id } = await req.json();
  if (!parent_job_id) return new Response("Missing parent_job_id", { status: 400 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { global: { fetch }, auth: { persistSession: false } });
  const log = (m:string)=>console.log(`[Compositor][${parent_job_id}] ${m}`);
  const workerId = crypto.randomUUID();

  try {
    const { data: claimedJob, error: claimError } = await supabase.rpc('claim_compositor_job', { p_job_id: parent_job_id, p_worker_id: workerId });
    if (claimError) throw new Error(`Failed to claim job: ${claimError.message}`);
    if (!claimedJob) { log("Job is locked by another worker or not ready. Exiting."); return new Response("ok"); }

    const { data: tilesRaw, error: e2 } = await supabase.from("mira_agent_tiled_upscale_tiles").select("coordinates,generated_tile_bucket,generated_tile_path,generated_tile_url,status").eq("parent_job_id", parent_job_id).eq("status", "complete");
    if (e2) throw e2;

    const completeTiles = (tilesRaw ?? []).filter(isValidTile);
    if (!completeTiles.length) throw new Error("No valid completed tiles found.");
    completeTiles.sort((a,b) => gridY(a) - gridY(b) || gridX(a) - gridX(b));

    const startIndex = claimedJob.comp_next_index || 0;
    if (startIndex >= completeTiles.length) { log("All tiles already processed. Moving to finalization."); }

    const actualTileSize = claimedJob.tile_size || TILE_SIZE * (claimedJob.upscale_factor || 2.0);
    const scaleFactor = actualTileSize / TILE_SIZE;
    const finalW = claimedJob.canvas_w;
    const finalH = claimedJob.canvas_h;
    const ovScaled = Math.min(Math.max(1, Math.round(TILE_OVERLAP * scaleFactor)), MAX_FEATHER, actualTileSize - 1);
    const stepScaled = actualTileSize - ovScaled;

    let canvas: Image;
    if (startIndex === 0) {
      canvas = new Image(finalW, finalH);
    } else {
      const { data: stateBlob, error: downloadError } = await supabase.storage.from(claimedJob.comp_state_bucket).download(claimedJob.comp_state_path);
      if (downloadError) throw downloadError;
      canvas = await Image.decode(await stateBlob.arrayBuffer());
    }

    const occupy = new Set<string>();
    for (const t of completeTiles) occupy.add(`${gridX(t)}:${gridY(t)}`);
    const hasAt = (gx:number,gy:number)=>occupy.has(`${gx}:${gy}`);

    const endIndex = Math.min(startIndex + BATCH_SIZE, completeTiles.length);
    for (let i = startIndex; i < endIndex; i++) {
      const t = completeTiles[i];
      const arr = await downloadTileBytes(supabase, t);
      let tile = await Image.decode(arr);
      if (tile.width !== actualTileSize) tile.resize(actualTileSize, actualTileSize);

      const x = Math.round(t.coordinates.x * scaleFactor);
      const y = Math.round(t.coordinates.y * scaleFactor);
      const gx = gridX(t), gy = gridY(t);
      const n = { left: hasAt(gx-1,gy), right: hasAt(gx+1,gy), top: hasAt(gx,gy-1), bottom: hasAt(gx,gy+1) };
      const incoming = { left: n.left, right: false, top: n.top, bottom: false };
      if (incoming.left || incoming.top) featherBandsLUT(tile, ovScaled, incoming);
      canvas.composite(tile, x, y);
      // @ts-ignore
      tile = null;
      await new Promise(r => setTimeout(r, 0));
    }

    if (endIndex < completeTiles.length) {
      const statePath = `${claimedJob.user_id}/${parent_job_id}/compositor_state.png`;
      const stateBuffer = await canvas.encode(0);
      await supabase.storage.from(STATE_BUCKET).upload(statePath, stateBuffer, { contentType: 'image/png', upsert: true });
      await supabase.from("mira_agent_tiled_upscale_jobs").update({ comp_next_index: endIndex, comp_state_bucket: STATE_BUCKET, comp_state_path: statePath, comp_lease_expires_at: new Date(Date.now() + 3 * 60000).toISOString() }).eq("id", parent_job_id);
      log(`Checkpoint saved. Processed tiles ${startIndex}-${endIndex-1}.`);
    } else {
      log("All tiles composited. Finalizing image...");
      const px = finalW * finalH;
      const effQ = px > 64e6 ? Math.min(75, JPEG_QUALITY) : px > 36e6 ? Math.min(80, JPEG_QUALITY) : JPEG_QUALITY;
      const outBytes = await canvas.encodeJPEG(effQ);
      const outPath = `${claimedJob.user_id}/${parent_job_id}/tiled-upscale-final-${finalW}x${finalH}.jpg`;
      await supabase.storage.from(BUCKET_OUT).upload(outPath, outBytes, { contentType: "image/jpeg", upsert: true });
      const { data: pub } = supabase.storage.from(BUCKET_OUT).getPublicUrl(outPath);
      await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "complete", final_image_url: pub.publicUrl, comp_next_index: endIndex, comp_state_path: null, comp_state_bucket: null, compositor_worker_id: null, comp_lease_expires_at: null }).eq("id", parent_job_id);
      log(`Compositing complete. Final URL: ${pub.publicUrl}`);
      await supabase.storage.from(STATE_BUCKET).remove([`${claimedJob.user_id}/${parent_job_id}/compositor_state.png`]);
    }
    return new Response("ok");
  } catch (err:any) {
    console.error(`[Compositor][${parent_job_id}] FATAL ERROR:`, err);
    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "failed", error_message: `Compositor failed: ${err.message}` }).eq("id", parent_job_id);
    return new Response(String(err?.message ?? err), { status: 500 });
  }
});