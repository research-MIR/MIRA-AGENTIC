import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Helper function to upscale a single base64 image.
 * @param base64 The base64 string of the image to upscale.
 * @param factor The factor by which to scale the image (e.g., 2.0).
 * @returns A base64 string of the upscaled image.
 */
async function upscaleImage(base64: string, factor: number): Promise<string> {
  const image = await loadImage(`data:image/png;base64,${base64}`);
  
  // FIX: Round dimensions to the nearest integer as createCanvas may not support floats.
  const newWidth = Math.round(image.width() * factor);
  const newHeight = Math.round(image.height() * factor);

  // Add a check for valid dimensions before creating the canvas.
  if (newWidth <= 0 || newHeight <= 0) {
    throw new Error(`Invalid upscaled dimensions: ${newWidth}x${newHeight}`);
  }

  const canvas = createCanvas(newWidth, newHeight);
  const ctx = canvas.getContext('2d');

  // Use high-quality interpolation, which often uses Lanczos or a similar algorithm.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Draw the original image onto the new, larger canvas. The canvas API handles the scaling.
  ctx.drawImage(image, 0, 0, newWidth, newHeight);

  // Return the upscaled image as a base64 string.
  // We remove the 'data:image/png;base64,' prefix.
  return canvas.toDataURL().split(',')[1];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { source_crop_base64, mask_crop_base64, upscale_factor } = await req.json();

    if (!source_crop_base64 || !mask_crop_base64 || !upscale_factor) {
      throw new Error("source_crop_base64, mask_crop_base64, and upscale_factor are required.");
    }

    console.log(`[UpscaleCropTool] Received job. Upscaling by factor: ${upscale_factor}`);

    // Perform the upscaling on both images in parallel.
    const [upscaled_source_base64, upscaled_mask_base64] = await Promise.all([
      upscaleImage(source_crop_base64, upscale_factor),
      upscaleImage(mask_crop_base64, upscale_factor)
    ]);

    console.log(`[UpscaleCropTool] Upscaling complete.`);

    return new Response(JSON.stringify({
      upscaled_source_base64,
      upscaled_mask_base64
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[UpscaleCropTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});