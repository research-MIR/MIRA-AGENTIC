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
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;

serve(async (req)=>{
  const requestId = req.headers.get("x-request-id") || `agent-fal-${Date.now()}`;
  console.log(`[ImageGenerator-Fal][${requestId}] Function invoked.`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!FAL_KEY || !supabaseUrl || !supabaseServiceRoleKey) {
    console.error(`[ImageGenerator-Fal][${requestId}] CRITICAL: Missing environment variables.`);
    return new Response(JSON.stringify({ error: "Server configuration error for AI services." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);
  
  try {
    const { prompt, number_of_images, seed, model_id, invoker_user_id, size } = await req.json();
    console.log(`[ImageGenerator-Fal][${requestId}] Received request with prompt: "${prompt.substring(0, 50)}..."`);

    if (!prompt) throw new Error("Prompt is required.");
    if (!invoker_user_id) throw new Error("invoker_user_id is required to attribute image generation.");

    const { data: modelConfig, error: modelError } = await supabaseAdmin
      .from('mira-agent-models')
      .select('default_loras')
      .eq('model_id_string', model_id)
      .single();
    
    if (modelError) throw new Error(`Could not retrieve model configuration: ${modelError.message}`);
    const defaultLoras = modelConfig.default_loras || [];
    console.log(`[ImageGenerator-Fal][${requestId}] Found ${defaultLoras.length} default LoRAs.`);

    const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('images_generated_count, image_generation_quota').eq('id', invoker_user_id).single();
    if (profileError) throw new Error(`Could not retrieve user profile: ${profileError.message}`);
    
    const finalImageCount = number_of_images || 1;
    if (profile.images_generated_count + finalImageCount > profile.image_generation_quota) {
        throw new Error(`Quota exceeded. User has ${profile.image_generation_quota - profile.images_generated_count} generations left but requested ${finalImageCount}.`);
    }
    console.log(`[ImageGenerator-Fal][${requestId}] Quota check passed for user ${invoker_user_id}.`);

    fal.config({
        credentials: FAL_KEY,
    });

    const [width, height] = size ? size.split('x').map(Number) : [1024, 1024];

    const generationPromises = Array.from({ length: finalImageCount }).map((_, i) => {
      const falInput: any = {
        prompt: prompt,
        image_size: { 
            width: width || 1024,
            height: height || 1024
        },
        output_format: "png",
        num_inference_steps: 28,
        guidance_scale: 3.5,
        seed: seed ? Number(seed) + i : undefined,
        enable_safety_checker: false,
      };

      if (defaultLoras && defaultLoras.length > 0) {
        falInput.loras = defaultLoras;
      }

      return (async () => {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            console.log(`[ImageGenerator-Fal][${requestId}] Preparing to call Fal.ai, attempt ${attempt}/${MAX_RETRIES} for image ${i+1}.`);
            console.log(`[ImageGenerator-Fal][${requestId}] Full Fal.ai Input Payload:\n${JSON.stringify(falInput, null, 2)}`);
            
            const result: any = await fal.subscribe("fal-ai/flux-lora", {
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
                console.error(`[ImageGenerator-Fal][${requestId}] Fal.ai returned an unexpected response or no images in data.images:`, JSON.stringify(result, null, 2));
                throw new Error("Fal.ai did not return any images in the expected format.");
            }
            return images[0];
          } catch (error) {
            console.warn(`[ImageGenerator-Fal][${requestId}] Attempt ${attempt} failed for image ${i+1}: ${error.message}`);
            if (attempt === MAX_RETRIES) throw error;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          }
        }
      })();
    });

    const settledResults = await Promise.allSettled(generationPromises);
    const successfulPredictions = settledResults
        .filter(r => r.status === 'fulfilled' && r.value)
        .map((r: any) => r.value);

    if (successfulPredictions.length === 0) throw new Error("Image generation failed after all retries.");
    console.log(`[ImageGenerator-Fal][${requestId}] Successfully generated ${successfulPredictions.length} images from Fal.ai.`);

    const uploadPromises = successfulPredictions.map(async (prediction, index) => {
      const imageUrl = prediction.url;
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) throw new Error(`Failed to download generated image from ${imageUrl}`);
      const imageBuffer = await imageResponse.arrayBuffer();

      const filePath = `${invoker_user_id}/${Date.now()}_fal_${index}.png`;
      await supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
      const { data: { publicUrl } } = supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
      return { storagePath: filePath, publicUrl };
    });

    const processedImages = await Promise.all(uploadPromises);
    await supabaseAdmin.rpc('increment_images_generated_count', { p_user_id: invoker_user_id, p_images_to_add: processedImages.length });
    console.log(`[ImageGenerator-Fal][${requestId}] Uploaded ${processedImages.length} images to storage and updated user quota.`);

    const finalResult = {
      isImageGeneration: true,
      message: `Successfully generated ${processedImages.length} images.`,
      images: processedImages
    };

    return new Response(JSON.stringify(finalResult), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    console.error(`[ImageGenerator-Fal][${requestId}] UNHANDLED ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});