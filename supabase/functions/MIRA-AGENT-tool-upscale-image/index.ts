import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fal } from 'npm:@fal-ai/client@1.5.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const FAL_KEY = Deno.env.get('FAL_KEY');

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `upscale-${Date.now()}`;
  console.log(`[Upscaler][${requestId}] Function invoked.`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!FAL_KEY) {
    console.error(`[Upscaler][${requestId}] CRITICAL: Missing FAL_KEY environment variable.`);
    return new Response(JSON.stringify({ error: "Server configuration error for AI services." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }

  try {
    const { image_url } = await req.json();
    if (!image_url) {
      throw new Error("image_url is required.");
    }

    console.log(`[Upscaler][${requestId}] Upscaling image: ${image_url}`);
    fal.config({ credentials: FAL_KEY });

    const result: any = await fal.subscribe("fal-ai/aura-sr", {
      input: {
        image_url: image_url,
        upscaling_factor: 4, // Note: This model only supports 4x upscaling.
        checkpoint: "v2"
      },
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs) {
          update.logs.forEach((log) => console.log(`[Fal-Log][${requestId}] ${log.message}`));
        }
      },
    });

    console.log(`[Upscaler][${requestId}] Full response from Fal.ai:`, JSON.stringify(result, null, 2));

    const upscaledImage = result?.data?.image;
    if (!upscaledImage || !upscaledImage.url) {
      throw new Error("Upscaling service did not return a valid image URL.");
    }

    console.log(`[Upscaler][${requestId}] Successfully upscaled image. New URL: ${upscaledImage.url}`);

    return new Response(JSON.stringify({ upscaled_url: upscaledImage.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error(`[Upscaler][${requestId}] UNHANDLED ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});