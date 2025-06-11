import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const FAL_KEY = Deno.env.get('FAL_KEY');

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `clarity-upscaler-${Date.now()}`;
  console.log(`[ClarityUpscaler][${requestId}] Function invoked.`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  if (!FAL_KEY) {
    console.error(`[ClarityUpscaler][${requestId}] CRITICAL: Missing FAL_KEY environment variable.`);
    return new Response(JSON.stringify({ error: "Server configuration error for AI services." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }

  try {
    const { image_url, job_id, upscale_factor } = await req.json();
    if (!image_url || !job_id || !upscale_factor) {
      throw new Error("image_url, job_id, and upscale_factor are required.");
    }

    console.log(`[ClarityUpscaler][${requestId}] Upscaling image: ${image_url} for job ${job_id} with factor ${upscale_factor}`);

    const { data: job, error: fetchError } = await supabaseAdmin
      .from('mira-agent-jobs')
      .select('context')
      .eq('id', job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job details: ${fetchError.message}`);

    const history = job.context?.history || [];
    const lastArtisanResponse = [...history].reverse().find(turn => 
        turn.role === 'function' && 
        turn.parts[0]?.functionResponse?.name === 'dispatch_to_artisan_engine'
    );

    const prompt = lastArtisanResponse?.parts[0]?.functionResponse?.response?.prompt || "masterpiece, best quality, highres";
    console.log(`[ClarityUpscaler][${requestId}] Found prompt: "${prompt.substring(0, 50)}..."`);

    fal.config({ credentials: FAL_KEY });

    const falInput = {
        image_url: image_url,
        prompt: prompt,
        upscale_factor: upscale_factor,
        negative_prompt: "(worst quality, low quality, normal quality:2)",
        creativity: 0.25,
        resemblance: 0.85,
        guidance_scale: 4,
        num_inference_steps: 18,
        enable_safety_checker: false
    };

    console.log(`[ClarityUpscaler][${requestId}] Calling fal-ai/clarity-upscaler with payload:`, JSON.stringify(falInput, null, 2));

    const result: any = await fal.subscribe("fal-ai/clarity-upscaler", {
      input: falInput,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs) {
          update.logs.forEach((log) => console.log(`[Fal-Log][${requestId}] ${log.message}`));
        }
      },
    });

    const upscaledImage = result?.data?.image;
    if (!upscaledImage || !upscaledImage.url) {
      throw new Error("Upscaling service did not return a valid image URL.");
    }

    console.log(`[ClarityUpscaler][${requestId}] Successfully upscaled image. New URL: ${upscaledImage.url}`);

    return new Response(JSON.stringify({ upscaled_image: upscaledImage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error(`[ClarityUpscaler][${requestId}] UNHANDLED ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});