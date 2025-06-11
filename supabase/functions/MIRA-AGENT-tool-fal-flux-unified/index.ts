import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { decode } from "https://deno.land/std@0.208.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const FAL_KEY = Deno.env.get('FAL_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

interface ImageData {
    data: string; // base64 encoded string
    mimeType: string;
}

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `fal-flux-${Date.now()}`;
  console.log(`[FalFluxUnified][${requestId}] Function invoked.`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  if (!FAL_KEY) {
    console.error(`[FalFluxUnified][${requestId}] CRITICAL: Missing FAL_KEY environment variable.`);
    return new Response(JSON.stringify({ error: "Server configuration error for AI services." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }

  try {
    const { prompt, reference_image, invoker_user_id, number_of_images = 1, seed, aspect_ratio = "1:1" } = await req.json();
    if (!prompt || !invoker_user_id) {
      throw new Error("prompt and invoker_user_id are required.");
    }

    const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('images_generated_count, image_generation_quota').eq('id', invoker_user_id).single();
    if (profileError) throw new Error(`Could not retrieve user profile: ${profileError.message}`);
    if (profile.images_generated_count + number_of_images > profile.image_generation_quota) {
        throw new Error(`Quota exceeded.`);
    }
    console.log(`[FalFluxUnified][${requestId}] Quota check passed for user ${invoker_user_id}.`);

    fal.config({ credentials: FAL_KEY });

    let modelId: string;
    const falInput: any = {
        prompt: prompt,
        num_images: number_of_images,
        seed: seed,
        enable_safety_checker: false, // Per user request
        raw: true, // Per user request
        aspect_ratio: aspect_ratio,
    };

    if (reference_image) {
        console.log(`[FalFluxUnified][${requestId}] Mode: Image-to-Image`);
        modelId = "fal-ai/flux-pro/v1.1-ultra/redux";
        
        const imageBuffer = decode(reference_image.data);
        const imageBlob = new Blob([imageBuffer], { type: reference_image.mimeType });
        const uploadedUrl = await fal.storage.upload(imageBlob);
        console.log(`[FalFluxUnified][${requestId}] Uploaded reference image to Fal storage: ${uploadedUrl}`);

        falInput.image_url = uploadedUrl;
        falInput.image_prompt_strength = 0.1; // Per user request
    } else {
        console.log(`[FalFluxUnified][${requestId}] Mode: Text-to-Image`);
        modelId = "fal-ai/flux-pro/v1.1-ultra";
    }

    console.log(`[FalFluxUnified][${requestId}] Calling model '${modelId}' with input:`, JSON.stringify(falInput, null, 2));
    const result: any = await fal.subscribe(modelId, {
      input: falInput,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs) {
          update.logs.forEach((log) => console.log(`[Fal-Log][${requestId}] ${log.message}`));
        }
      },
    });

    const images = result?.data?.images;
    if (!images || images.length === 0) {
      throw new Error("Fal.ai model did not return any images.");
    }
    console.log(`[FalFluxUnified][${requestId}] Successfully generated ${images.length} images from Fal.ai.`);

    const uploadPromises = images.map(async (image: any, index: number) => {
      const imageResponse = await fetch(image.url);
      if (!imageResponse.ok) throw new Error(`Failed to download generated image from ${image.url}`);
      const imageBuffer = await imageResponse.arrayBuffer();
      const filePath = `${invoker_user_id}/${Date.now()}_flux_${index}.png`;
      await supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
      const { data: { publicUrl } } = supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
      return { storagePath: filePath, publicUrl };
    });

    const processedImages = await Promise.all(uploadPromises);
    await supabaseAdmin.rpc('increment_images_generated_count', { p_user_id: invoker_user_id, p_images_to_add: processedImages.length });
    console.log(`[FalFluxUnified][${requestId}] Uploaded ${processedImages.length} images to storage and updated user quota.`);

    const finalResult = {
      isImageGeneration: true,
      message: `Successfully generated ${processedImages.length} images with FLUX.`,
      images: processedImages
    };

    return new Response(JSON.stringify(finalResult), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    console.error(`[FalFluxUnified][${requestId}] UNHANDLED ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});