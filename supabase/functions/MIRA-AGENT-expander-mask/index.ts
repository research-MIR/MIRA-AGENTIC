import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array | null, userId: string, filename: string): Promise<string | null> {
  if (!buffer) return null;
  const filePath = `${userId}/vto-debug/${Date.now()}-${filename}`;
  const { error } = await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, buffer, {
    contentType: 'image/png',
    upsert: true
  });
  if (error) {
    console.error(`Storage upload failed for ${filename}: ${error.message}`);
    throw new Error(`Storage upload failed for ${filename}: ${error.message}`);
  }
  const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
  return publicUrl;
}

/**
 * Performs a fast, linear-time dilation on an alpha channel mask.
 * This is highly memory and CPU efficient.
 */
function dilateAlpha(alpha: Uint8ClampedArray, w: number, h: number, r: number) {
  const inf = 1e9;
  const dist = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    let d = inf;
    for (let x = 0; x < w; x++) {
      if (alpha[y * w + x]) d = 0;
      dist[y * w + x] = d = Math.min(d + 1, inf);
    }
    d = inf;
    for (let x = w - 1; x >= 0; x--) {
      if (alpha[y * w + x]) d = 0;
      dist[y * w + x] = Math.min(dist[y * w + x], (d = Math.min(d + 1, inf)));
    }
  }

  for (let x = 0; x < w; x++) {
    let d = inf;
    for (let y = 0; y < h; y++) {
      d = Math.min(d + 1, dist[y * w + x]);
      dist[y * w + x] = d;
    }
    d = inf;
    for (let y = h - 1; y >= 0; y--) {
      d = Math.min(d + 1, dist[y * w + x]);
      const idx = y * w + x;
      if (Math.min(d, dist[idx]) <= r) alpha[idx] = 255;
      else alpha[idx] = 0;
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders
    });
  }

  const { raw_mask_url, user_id, parent_pair_job_id } = await req.json();
  if (!raw_mask_url || !user_id || !parent_pair_job_id) {
    throw new Error("raw_mask_url, user_id, and parent_pair_job_id are required.");
  }

  const requestId = `expander-${parent_pair_job_id}`;
  console.log(`[Expander][${requestId}] Function invoked.`);
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const response = await fetch(raw_mask_url);
    if (!response.ok) throw new Error(`Failed to download raw mask from ${raw_mask_url}`);
    const rawMaskBuffer = await response.arrayBuffer();
    const rawMaskImage = await loadImage(new Uint8Array(rawMaskBuffer));

    const originalWidth = rawMaskImage.width();
    const originalHeight = rawMaskImage.height();

    // --- Down-scaling for large images ---
    const MAX_DIMENSION = 5048;
    let scale = 1;
    let w = originalWidth;
    let h = originalHeight;
    if (Math.max(w, h) > MAX_DIMENSION) {
      scale = MAX_DIMENSION / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      console.log(`[Expander][${requestId}] Image too large, down-scaling to ${w}x${h}`);
    }

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(rawMaskImage, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const alphaChannel = new Uint8ClampedArray(w * h);
    for (let i = 0; i < imageData.data.length; i += 4) {
      alphaChannel[i / 4] = imageData.data[i] > 128 ? 255 : 0;
    }

    const expansionPx = Math.max(1, Math.round(Math.min(w, h) * 0.03));
    console.log(`[Expander][${requestId}] Expanding alpha mask by ${expansionPx}px.`);
    dilateAlpha(alphaChannel, w, h, expansionPx);

    // Create the final black and white mask from the dilated alpha channel
    for (let i = 0; i < alphaChannel.length; i++) {
      const value = alphaChannel[i];
      imageData.data[i * 4] = value;
      imageData.data[i * 4 + 1] = value;
      imageData.data[i * 4 + 2] = value;
      imageData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);

    let finalCanvas = canvas;
    if (scale < 1) {
      console.log(`[Expander][${requestId}] Scaling mask back up to ${originalWidth}x${originalHeight}.`);
      const upscaledCanvas = createCanvas(originalWidth, originalHeight);
      const upscaledCtx = upscaledCanvas.getContext('2d');
      upscaledCtx.imageSmoothingEnabled = false;
      upscaledCtx.drawImage(canvas, 0, 0, originalWidth, originalHeight);
      finalCanvas = upscaledCanvas;
    }

    const finalMaskBuffer = finalCanvas.toBuffer('image/png');
    const expandedMaskUrl = await uploadBufferToStorage(supabase, finalMaskBuffer, user_id, 'final_expanded_mask.png');
    if (!expandedMaskUrl) throw new Error("Failed to upload the final expanded mask.");
    console.log(`[Expander][${requestId}] Final expanded mask uploaded to: ${expandedMaskUrl}`);

    const { data: parentPairJob, error: parentFetchError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('metadata').eq('id', parent_pair_job_id).single();
    if (parentFetchError) throw parentFetchError;

    const debug_assets = {
      ...parentPairJob.metadata?.debug_assets,
      raw_mask_url,
      expanded_mask_url: expandedMaskUrl
    };

    console.log(`[Expander][${requestId}] Updating parent job ${parent_pair_job_id} to 'processing_step_2' status.`);
    await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
      status: 'processing_step_2',
      metadata: {
        ...parentPairJob.metadata,
        debug_assets: debug_assets
      }
    }).eq('id', parent_pair_job_id);

    console.log(`[Expander][${requestId}] Job complete. The watchdog will now handle the next step.`);

    return new Response(JSON.stringify({
      success: true,
      expandedMaskUrl
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(`[Expander][${parent_pair_job_id || 'unknown'}] Error:`, error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});