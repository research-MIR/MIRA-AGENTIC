import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

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

async function invokeWithRetry(supabase: SupabaseClient, functionName: string, payload: object, maxRetries = 3, logPrefix = "") {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const { error } = await supabase.functions.invoke(functionName, payload);
            if (error) {
                throw new Error(error.message || 'Function invocation failed with an unknown error.');
            }
            console.log(`${logPrefix} Successfully invoked ${functionName} on attempt ${attempt}.`);
            return; // Success
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`${logPrefix} Invocation of '${functionName}' failed on attempt ${attempt}/${maxRetries}. Error: ${lastError.message}`);
            if (attempt < maxRetries) {
                const delay = 20000 * Math.pow(2, attempt - 1); // 20s, 40s, 80s...
                console.warn(`${logPrefix} Waiting ${delay}ms before retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    // If all retries fail, throw the last error
    throw lastError || new Error(`Function ${functionName} failed after all retries without a specific error.`);
}

function dilateRoiUsingSAT(alphaWhole: Uint8ClampedArray, w: number, h: number,
                           x0: number, y0: number, roiW: number, roiH: number, r: number) {
  // Build a binary ROI (0/1) from alpha
  const bin = new Uint8Array(roiW * roiH);
  for (let yy = 0; yy < roiH; yy++) {
    const srcRow = (y0 + yy) * w;
    const dstRow = yy * roiW;
    for (let xx = 0; xx < roiW; xx++) {
      bin[dstRow + xx] = alphaWhole[srcRow + (x0 + xx)] ? 1 : 0;
    }
  }

  // Summed Area Table of size (roiW+1)*(roiH+1)
  const satW = roiW + 1;
  const sat = new Uint32Array(satW * (roiH + 1));
  for (let yy = 1; yy <= roiH; yy++) {
    let rowSum = 0;
    const base = (yy - 1) * roiW;
    for (let xx = 1; xx <= roiW; xx++) {
      rowSum += bin[base + (xx - 1)];
      sat[yy * satW + xx] = sat[(yy - 1) * satW + xx] + rowSum;
    }
  }

  // Output dilated ROI (0/255)
  const out = new Uint8ClampedArray(roiW * roiH);
  // We expanded the ROI by r; still guard edges
  for (let yy = 0; yy < roiH; yy++) {
    const y1 = Math.max(1, yy + 1 - r);
    const y2 = Math.min(roiH, yy + 1 + r);
    for (let xx = 0; xx < roiW; xx++) {
      const x1 = Math.max(1, xx + 1 - r);
      const x2 = Math.min(roiW, xx + 1 + r);
      const sum = sat[y2 * satW + x2]
                - sat[(y1 - 1) * satW + x2]
                - sat[y2 * satW + (x1 - 1)]
                + sat[(y1 - 1) * satW + (x1 - 1)];
      out[yy * roiW + xx] = sum > 0 ? 255 : 0;
    }
  }
  return out;
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

    // --- New Scaling Logic ---
    const LONG_SIDE_MIN = 1440;
    const LONG_SIDE_CAP = 3072;
    const MAX_PIXELS = 22_000_000;

    let scale = 1;
    let w = originalWidth;
    let h = originalHeight;
    const longSide = Math.max(w, h);

    if (longSide > LONG_SIDE_CAP) {
        const target = Math.max(LONG_SIDE_MIN, LONG_SIDE_CAP);
        scale = target / longSide;
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        console.log(`[Expander][${requestId}] Downscaling to ${w}x${h} (long side ≥ ${LONG_SIDE_MIN}).`);
    }

    if (w * h > MAX_PIXELS) {
        throw new Error(`Image too large for mask expansion at ${w}x${h}.`);
    }
    // --- End Scaling Logic ---

    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(rawMaskImage, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    // --- New BBox Calculation while Thresholding ---
    let minX = w, minY = h, maxX = -1, maxY = -1;
    const alphaChannel = new Uint8ClampedArray(w * h);

    for (let i = 0, p = 0, y = 0, x = 0; i < data.length; i += 4, p++) {
        const on = data[i] > 128 ? 255 : 0;
        alphaChannel[p] = on;
        if (on) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }
        x++;
        if (x === w) { x = 0; y++; }
    }

    if (maxX === -1) { // Mask is empty
        console.warn(`[Expander][${requestId}] Mask is empty. Returning a black mask.`);
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, w, h);
    } else {
        const expansionPx = Math.max(1, Math.round(Math.min(w, h) * 0.03));
        console.log(`[Expander][${requestId}] Expanding alpha mask by ${expansionPx}px.`);

        // --- ROI Calculation ---
        const x0 = Math.max(0, minX - expansionPx);
        const y0 = Math.max(0, minY - expansionPx);
        const x1 = Math.min(w - 1, maxX + expansionPx);
        const y1 = Math.min(h - 1, maxY + expansionPx);
        const roiW = x1 - x0 + 1;
        const roiH = y1 - y0 + 1;
        // --- End ROI Calculation ---

        // --- SAT Dilation on ROI ---
        const dilatedRoi = dilateRoiUsingSAT(alphaChannel, w, h, x0, y0, roiW, roiH, expansionPx);
        
        // Create an empty black frame once and paint only the ROI
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, w, h);
        const roiImageData = ctx.createImageData(roiW, roiH);
        for (let i = 0, j = 0; i < dilatedRoi.length; i++, j += 4) {
            const v = dilatedRoi[i];
            roiImageData.data[j] = v;
            roiImageData.data[j + 1] = v;
            roiImageData.data[j + 2] = v;
            roiImageData.data[j + 3] = 255;
        }
        ctx.putImageData(roiImageData, x0, y0);
        // --- End SAT Dilation ---
    }

    let finalCanvas = canvas;
    if (scale < 1) {
      console.log(`[Expander][${requestId}] Scaling mask back up to ${originalWidth}x${originalHeight}.`);
      const upscaledCanvas = createCanvas(originalWidth, originalHeight);
      const upscaledCtx = upscaledCanvas.getContext('2d');
      upscaledCtx.imageSmoothingEnabled = false; // Use nearest-neighbor for sharp edges
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

    console.log(`[Expander][${requestId}] Updating parent job ${parent_pair_job_id} to 'mask_expanded' status.`);
    await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
      status: 'mask_expanded',
      metadata: {
        ...parentPairJob.metadata,
        debug_assets: debug_assets
      }
    }).eq('id', parent_pair_job_id);

    console.log(`[Expander][${requestId}] Invoking next worker in chain: MIRA-AGENT-worker-batch-inpaint-step2`);
    await invokeWithRetry(
        supabase,
        'MIRA-AGENT-worker-batch-inpaint-step2',
        { body: { pair_job_id: parent_pair_job_id, final_mask_url: expandedMaskUrl } },
        3, // maxRetries
        `[Expander][${requestId}]`
    );

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