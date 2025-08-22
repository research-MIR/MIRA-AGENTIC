import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TILE_UPLOAD_BUCKET = "mira-agent-upscale-tiles";

const INSERT_BATCH_SIZE = 100;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let parent_job_id: string | undefined;

  try {
    const body = await req.json();
    parent_job_id = body?.parent_job_id;
    if (!parent_job_id) throw new Error("parent_job_id is required.");

    const logPrefix = `[TilingWorker][${parent_job_id}]`;
    console.log(`${logPrefix} Invoked. Tiling on base image and queuing for next step.`);

    const { data: job, error: fetchError } = await supabase
      .from("mira_agent_tiled_upscale_jobs")
      .select("source_bucket, source_path, user_id, upscale_factor, metadata")
      .eq("id", parent_job_id)
      .single();
    if (fetchError) throw fetchError;
    if (!job.source_bucket || !job.source_path) {
        throw new Error("Parent job is missing source_bucket or source_path.");
    }

    const engine = job.metadata?.upscaler_engine || 'enhancor_detailed';
    const initialStatus = engine.startsWith('comfyui') ? 'pending_analysis' : 'pending_generation';
    console.log(`${logPrefix} Engine is '${engine}'. Initial tile status will be '${initialStatus}'.`);

    const { data: blob, error: downloadError } = await supabase.storage.from(job.source_bucket).download(job.source_path);
    if (downloadError) throw downloadError;

    const img = await Image.decode(await blob.arrayBuffer());
    console.log(`${logPrefix} Decoded original image: ${img.width}x${img.height}`);

    const USE_HARDCODED_OVERRIDE = false;
    const HARDCODED_TILE_SIZE = 768;

    let TILE_SIZE = 768;
    let TILE_OVERLAP = 96;

    if (USE_HARDCODED_OVERRIDE) {
        TILE_SIZE = HARDCODED_TILE_SIZE;
        console.log(`${logPrefix} Using hardcoded override tile size: ${TILE_SIZE}`);
    } else if (job.metadata?.tile_size) {
        const userTileSize = job.metadata.tile_size;
        if (userTileSize === 'full_size') {
            TILE_SIZE = Math.max(img.width, img.height);
            console.log(`${logPrefix} Using 'full_size' option. Tile size set to largest dimension: ${TILE_SIZE}`);
        } else if (typeof userTileSize === 'number' && userTileSize >= 128 && userTileSize <= 1024) {
            TILE_SIZE = userTileSize;
            console.log(`${logPrefix} Using user-selected tile size: ${TILE_SIZE}`);
        } else {
            console.warn(`${logPrefix} Invalid tile_size in metadata: '${userTileSize}'. Falling back to default ${TILE_SIZE}.`);
        }
    } else {
        console.log(`${logPrefix} No tile_size in metadata. Using default: ${TILE_SIZE}`);
    }
    
    TILE_OVERLAP = Math.round(TILE_SIZE * 0.125);
    const STEP = TILE_SIZE - TILE_OVERLAP;
    console.log(`${logPrefix} Final tiling parameters -> Size: ${TILE_SIZE}, Overlap: ${TILE_OVERLAP}, Step: ${STEP}`);

    const upscale_factor = job.upscale_factor || 2.0;
    const finalW = Math.round(img.width * upscale_factor);
    const finalH = Math.round(img.height * upscale_factor);
    console.log(`${logPrefix} Calculated final dimensions: ${finalW}x${finalH} (factor: ${upscale_factor})`);

    const tilesX = img.width <= TILE_SIZE ? 1 : 1 + Math.ceil((img.width - TILE_SIZE) / STEP);
    const tilesY = img.height <= TILE_SIZE ? 1 : 1 + Math.ceil((img.height - TILE_SIZE) / STEP);
    const totalTiles = tilesX * tilesY;
    console.log(`${logPrefix} Calculated grid: ${tilesX}x${tilesY} (${totalTiles} total tiles)`);

    const batch: any[] = [];
    for (let i = 0; i < totalTiles; i++) {
        const gx = i % tilesX;
        const gy = Math.floor(i / tilesX);
        
        let x = (gx === tilesX - 1) ? img.width - TILE_SIZE : gx * STEP;
        x = Math.max(0, x);

        let y = (gy === tilesY - 1) ? img.height - TILE_SIZE : gy * STEP;
        y = Math.max(0, y);

        const tile = new Image(TILE_SIZE, TILE_SIZE);
        tile.composite(img, -x, -y);

        const tileBuffer = await tile.encode(2, 85);
        const filePath = `${job.user_id}/${parent_job_id}/tile_${i}.webp`;
        
        await supabase.storage.from(TILE_UPLOAD_BUCKET).upload(filePath, tileBuffer, {
            contentType: 'image/webp',
            upsert: true,
        });

        batch.push({
            parent_job_id,
            tile_index: i,
            coordinates: { x, y, width: TILE_SIZE, height: TILE_SIZE },
            source_tile_bucket: TILE_UPLOAD_BUCKET,
            source_tile_path: filePath,
            status: initialStatus,
        });

        if (batch.length >= INSERT_BATCH_SIZE) {
            const { error } = await supabase.from("mira_agent_tiled_upscale_tiles").upsert(batch, { onConflict: "parent_job_id,tile_index" });
            if (error) throw error;
            batch.length = 0;
        }
    }

    if (batch.length > 0) {
        const { error } = await supabase.from("mira_agent_tiled_upscale_tiles").upsert(batch, { onConflict: "parent_job_id,tile_index" });
        if (error) throw error;
    }

    await supabase.from("mira_agent_tiled_upscale_jobs").update({ 
        status: "queued_for_generation", 
        total_tiles: totalTiles,
        canvas_w: finalW,
        canvas_h: finalH
    }).eq("id", parent_job_id);
    console.log(`${logPrefix} Tiling complete. All tiles queued for the next step.`);

    return new Response(JSON.stringify({ success: true, tileCount: totalTiles }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[TilingWorker] FATAL:`, error);
    if (parent_job_id) {
      await supabase.from("mira_agent_tiled_upscale_jobs").update({ status: "failed", error_message: `Tiling failed: ${error.message}` }).eq("id", parent_job_id);
    }
    return new Response(JSON.stringify({ error: String(error?.message ?? error) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});