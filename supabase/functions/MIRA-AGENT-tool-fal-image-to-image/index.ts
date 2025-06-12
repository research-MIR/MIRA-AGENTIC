import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const FAL_KEY = Deno.env.get('FAL_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `agent-fal-img2img-${Date.now()}`;
  console.log(`[Fal-Img2Img][${requestId}] Function invoked for batch processing.`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  if (!FAL_KEY) {
    console.error(`[Fal-Img2Img][${requestId}] CRITICAL: Missing FAL_KEY environment variable.`);
    return new Response(JSON.stringify({ error: "Server configuration error for AI services." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }

  try {
    const { image_urls, prompt, invoker_user_id } = await req.json();
    if (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0 || !prompt || !invoker_user_id) {
      throw new Error("image_urls (as an array), prompt, and invoker_user_id are required.");
    }
    console.log(`[Fal-Img2Img][${requestId}] Processing batch of ${image_urls.length} images with prompt: "${prompt.substring(0, 50)}..."`);

    const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('images_generated_count, image_generation_quota').eq('id', invoker_user_id).single();
    if (profileError) throw new Error(`Could not retrieve user profile: ${profileError.message}`);
    
    if (profile.images_generated_count + image_urls.length > profile.image_generation_quota) {
        throw new Error(`Quota exceeded. User has ${profile.image_generation_quota - profile.images_generated_count} generations left but requested ${image_urls.length}.`);
    }
    console.log(`[Fal-Img2Img][${requestId}] Quota check passed for user ${invoker_user_id}.`);

    fal.config({ credentials: FAL_KEY });

    const refinementPromises = image_urls.map((imageUrl: string) => {
        return fal.subscribe("fal-ai/recraft/v3/image-to-image", {
            input: {
                prompt: prompt,
                image_url: imageUrl,
                strength: 0.35
            },
            logs: true,
            onQueueUpdate: (update) => {
                if (update.status === "IN_PROGRESS" && update.logs) {
                    update.logs.forEach((log) => console.log(`[Fal-Log][${requestId}] ${log.message}`));
                }
            },
        });
    });

    const settledResults = await Promise.allSettled(refinementPromises);
    const successfulResults = settledResults
        .filter(r => r.status === 'fulfilled' && r.value?.data?.images?.[0])
        .map((r: any) => r.value.data.images[0]);

    if (successfulResults.length === 0) {
        throw new Error("Fal.ai image-to-image tool failed to refine any images in the batch.");
    }
    console.log(`[Fal-Img2Img][${requestId}] Successfully refined ${successfulResults.length} images.`);

    const uploadPromises = successfulResults.map(async (image, index) => {
        const imageResponse = await fetch(image.url);
        if (!imageResponse.ok) throw new Error(`Failed to download generated image from ${image.url}`);
        const imageBuffer = await imageResponse.arrayBuffer();

        const filePath = `${invoker_user_id}/${Date.now()}_fal_img2img_batch_${index}.png`;
        await supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
        const { data: { publicUrl } } = supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
        return { storagePath: filePath, publicUrl };
    });

    const processedImages = await Promise.all(uploadPromises);
    await supabaseAdmin.rpc('increment_images_generated_count', { p_user_id: invoker_user_id, p_images_to_add: processedImages.length });
    console.log(`[Fal-Img2Img][${requestId}] Uploaded ${processedImages.length} images and updated user quota.`);

    const finalResult = {
      isImageGeneration: true,
      message: `Successfully refined ${processedImages.length} images with Fal.ai.`,
      images: processedImages
    };

    return new Response(JSON.stringify(finalResult), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    console.error(`[Fal-Img2Img][${requestId}] UNHANDLED ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});