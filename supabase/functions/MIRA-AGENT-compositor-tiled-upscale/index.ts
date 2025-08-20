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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function makeSmoothstepLUT(ov: number, invert = false) {
  const lut = new Uint8Array(ov);
  if (ov <= 1) { lut.fill(255); return lut; }
  for (let i = 0; i < ov; i++) {
    let t = i / (ov - 1);
    t = invert ? 1 - t : t;
    const s = t * t * (3 - 2 * t); // smoothstep
    lut[i] = Math.max(0, Math.min(255, (s * 255) | 0));
  }
  return lut;
}

function featherBandsLUT(tile: Image, ov: number, n: {left:boolean;right:boolean;top:boolean;bottom:boolean}) {
  if (ov <= 0) return;
  const W = tile.width, H = tile.height, bmp = tile.bitmap;
  const L = makeSmoothstepLUT(ov, false);
  const R = makeSmoothstepLUT(ov, true);

  // Horz bands (use LUT)
  if (n.left) {
    for (let y=0; y<H; y++) {
      let a = (y*W)*4 + 3;
      for (let x=0; x<ov; x++, a+=4) bmp[a] = (bmp[a] * L[x]) >>> 8;
    }
  }
  if (n.right) {
    for (let y=0; y<H; y++) {
      let a = (y*W + (W-ov))*4 + 3;
      for (let x=0; x<ov; x++, a+=4) bmp[a] = (bmp[a] * R[x]) >>> 8;
    }
  }

  // Vert bands
  if (n.top) {
    for (let y=0; y<ov; y++) {
      const s = L[y];
      let a = (y*W)*4 + 3;
      for (let x=0; x<W; x++, a+=4) bmp[a] = (bmp[a] * s) >>> 8;
    }
  }
  if (n.bottom) {
    for (let y=H-ov, i=0; y<H; y++, i++) {
      const s = R[i];
      let a = (y*W)*4 + 3;
      for (let x=0; x<W; x++, a+=4) bmp[a] = (bmp[a] * s) >>> 8;
    }
  }
}

const q = (v:number, step:number) => Math.floor((v + step * 0.5) / step);
function gridX(t:any){ return q(t.coordinates.x, STEP); }
function gridY(t:any){ return q(t.coordinates.y, STEP); }

async function* prefetch(tiles:any[], getUrl:(t:any)=>Promise<string>) {
  if (tiles.length === 0) return;
  let i = 0;
  let next = (async () => {
    const url = await getUrl(tiles[0]);
    const arr = new Uint8Array(await (await fetch(url)).arrayBuffer());
    return { i: 0, img: await Image.decode(arr) };
  })();

  for (; i < tiles.length; i++) {
    const cur = await next;
    if (i + 1 < tiles.length) {
      next = (async () => {
        const url = await getUrl(tiles[i+1]);
        const arr = new Uint8Array(await (await fetch(url)).arrayBuffer());
        return { i: i+1, img: await Image.decode(arr) };
      })();
    }
    yield cur;
  }
}

async function run(supabase: SupabaseClient, parent_job_id: string) {
  const logPrefix = `[Compositor][${parent_job_id}]`;
  console.log(`${logPrefix} Starting run.`);

  const { data: claimed, error: claimError } = await supabase
    .from('mira_agent_tiled_upscale_jobs')
    .update({ status: 'compositing' })
    .eq('id', parent_job_id)
    .in('status', ['generating', 'queued_for_generation', 'compositing'])
    .select('id, user_id, final_image_url')
    .single();

  if (claimError || !claimed) {
    console.log(`${logPrefix} Could not claim job. It might be locked by another process or in an invalid state. Exiting.`);
    return;
  }
  const parentRow = claimed;
  if (parentRow.final_image_url) { console.log(`${logPrefix} Already complete.`); return; }

  const { data: tiles, error: e2 } = await supabase
    .from("mira_agent_tiled_upscale_tiles")
    .select("tile_index,coordinates,generated_tile_bucket,generated_tile_path,generated_tile_url,status")
    .eq("parent_job_id", parent_job_id)
    .order("tile_index",{ascending:true});
  if (e2) throw new Error(e2.message);

  const completeTiles = (tiles ?? []).filter(t => t.status === "complete" && (t.generated_tile_url || (t.generated_tile_bucket && t.generated_tile_path)));
  if (!completeTiles.length) throw new Error("No completed tiles found with valid image references.");

  completeTiles.sort((a,b) => {
    const gyA = gridY(a);
    const gyB = gridY(b);
    if (gyA !== gyB) return gyA - gyB;
    const gxA = gridX(a);
    const gxB = gridX(b);
    return gxA - gxB;
  });

  const urlCache = new Map<string,string>();
  const urlFor = async (t:any) => {
    if (t.generated_tile_url) return t.generated_tile_url;
    const key = `${t.generated_tile_bucket}/${t.generated_tile_path}`;
    const cached = urlCache.get(key);
    if (cached) return cached;
    const { data } = await supabase.storage.from(t.generated_tile_bucket)
      .createSignedUrl(t.generated_tile_path, 180);
    if (!data || !data.signedUrl) throw new Error(`Failed to create signed URL for ${key}`);
    urlCache.set(key, data.signedUrl);
    return data.signedUrl;
  };

  const firstTileImage = await Image.decode(await (await fetch(await urlFor(completeTiles[0]))).arrayBuffer());
  const actualTileSize = firstTileImage.width;
  const scaleFactor = actualTileSize / TILE_SIZE;
  console.log(`${logPrefix} Detected upscale factor of ${scaleFactor}x (Tiles are ${actualTileSize}px)`);

  const maxX = Math.max(...completeTiles.map(t => t.coordinates.x));
  const maxY = Math.max(...completeTiles.map(t => t.coordinates.y));
  const finalW = Math.round((maxX + TILE_SIZE) * scaleFactor);
  const finalH = Math.round((maxY + TILE_SIZE) * scaleFactor);
  console.log(`${logPrefix} Final canvas dimensions will be ${finalW}x${finalH}`);

  const ovScaled = Math.min(Math.max(1, Math.round(TILE_OVERLAP * scaleFactor)), actualTileSize - 1);
  const stepScaled = actualTileSize - ovScaled;
  if (stepScaled <= 0) throw new Error(`Invalid stepScaled ${stepScaled}. Check TILE_OVERLAP vs tile size.`);

  const bytesCanvas = finalW * finalH * 4;
  const bytesTile = actualTileSize * actualTileSize * 4;
  const safetyMB = 32;
  const estMB = (bytesCanvas + bytesTile) / (1024*1024) + safetyMB;
  if (estMB > MEM_HARD_LIMIT_MB) {
    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "failed", error_message: `Estimated RAM ${estMB.toFixed(1)}MB exceeds limit ${MEM_HARD_LIMIT_MB}MB.` }).eq("id", parent_job_id);
    throw new Error(`Refused: est ${estMB.toFixed(1)} MB > limit ${MEM_HARD_LIMIT_MB}`);
  }

  const canvas = new Image(finalW, finalH);

  const occupied = new Set<string>();
  const key = (gx:number,gy:number)=>`${gx}:${gy}`;
  for (const t of completeTiles) occupied.add(key(gridX(t), gridY(t)));
  const hasAt = (gx:number,gy:number)=>occupied.has(key(gx,gy));

  for await (const { i, img } of prefetch(completeTiles, urlFor)) {
    const t = completeTiles[i];
    const gx = gridX(t), gy = gridY(t);
    const scaledX = gx * stepScaled;
    const scaledY = gy * stepScaled;

    const n = {
      left:   hasAt(gx-1, gy),
      right:  hasAt(gx+1, gy),
      top:    hasAt(gx, gy-1),
      bottom: hasAt(gx, gy+1),
    };

    if (n.left || n.right || n.top || n.bottom) featherBandsLUT(img, ovScaled, n);

    canvas.composite(img, scaledX, scaledY);

    if ((i + 1) % 6 === 0) await new Promise(r => setTimeout(r, 0));
  }

  const px = finalW * finalH;
  const effQuality = px > 64e6 ? Math.min(75, JPEG_QUALITY)
                   : px > 36e6 ? Math.min(80, JPEG_QUALITY)
                   : JPEG_QUALITY;
  const jpeg = await canvas.encodeJPEG(effQuality);
  const outPath = `${parentRow.user_id}/${parent_job_id}/tiled-upscale-final-${finalW}x${finalH}.jpg`;
  await supabase.storage.from(BUCKET_OUT).upload(outPath, jpeg, { contentType: "image/jpeg", upsert: true });
  const { data: pub } = supabase.storage.from(BUCKET_OUT).getPublicUrl(outPath);
  await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "complete", final_image_url: pub.publicUrl }).eq("id", parent_job_id);
  console.log(`${logPrefix} Compositing complete. Final URL: ${pub.publicUrl}`);
}

serve(async (req) => {
  const { parent_job_id } = await req.json();
  if (!parent_job_id) return new Response("Missing parent_job_id", { status: 400 });
  
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    global: { fetch }, auth: { persistSession: false }
  });

  try {
    await run(supabase, parent_job_id);
    return new Response("ok");
  } catch (err) {
    console.error(`[Compositor][${parent_job_id}] FATAL ERROR:`, err);
    await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "failed", error_message: `Compositor failed: ${err.message}` }).eq("id", parent_job_id);
    return new Response(String(err?.message ?? err), { status: 500 });
  }
});