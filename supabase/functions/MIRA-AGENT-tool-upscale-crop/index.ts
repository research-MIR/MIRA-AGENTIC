import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { source_crop_base64, mask_crop_base64 } = await req.json();

    if (!source_crop_base64 || !mask_crop_base64) {
      throw new Error("source_crop_base64 and mask_crop_base64 are required.");
    }

    console.log(`[UpscaleCropTool - TEST MODE] Bypassing upscale. Returning original crops.`);

    // In this test mode, we simply return the original base64 strings
    // without performing any upscaling.
    return new Response(JSON.stringify({
      upscaled_source_base64: source_crop_base64,
      upscaled_mask_base64: mask_crop_base64
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