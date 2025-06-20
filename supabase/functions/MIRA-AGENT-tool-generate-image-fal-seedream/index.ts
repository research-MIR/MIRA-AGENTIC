import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const FAL_KEY = Deno.env.get('FAL_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

async function describeImage(base64Data: string, mimeType: string): Promise<string> {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) return "No description available.";
    try {
        const { GoogleGenAI } = await import('https://esm.sh/@google/genai@0.15.0');
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const result = await ai.models.generateContent({
            model: "gemini-1.5-flash-latest",
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: base64Data } }] }],
            config: { systemInstruction: { role: "system", parts: [{ text: "Describe this image in a single, concise sentence." }] } }
        });
        return result.text.trim();
    } catch (error) {
        console.error("[ImageDescriber] Error:", error.message);
        return "Description generation failed.";
    }
}

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `agent-seedream-${Date.now()}`;
  console.log(`[SeedDreamTool][${requestId}] Function invoked.`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  if (!FAL_KEY) {
    return new Response(JSON.stringify({ error: "Server configuration error for AI services." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }

  try {
    const { prompt, number_of_images, negative_prompt, seed, model_id, invoker_user_id, size } = await req.json();
    if (!prompt || !invoker_user_id) {
      throw new Error("prompt and invoker_user_id are required.");
    }

    const { data: profile, error: profileError } = await supabaseAdmin.from('profiles').select('images_generated_count, image_generation_quota').eq('id', invoker_user_id).single();
    if (profileError) throw new Error(`Could not retrieve user profile: ${profileError.message}`);
    
    const finalImageCount = number_of_images || 1;
    if (profile.images_generated_count + finalImageCount > profile.image_generation_quota) {
        throw new Error(`Quota exceeded. User has ${profile.image_generation_quota - profile.images_generated_count} left but requested ${finalImageCount}.`);
    }

    fal.config({ credentials: FAL_KEY });

    const falInput = {
        prompt: prompt,
        aspect_ratio: size || "1:1",
        num_images: finalImageCount,
        seed: seed ? Number(seed) : undefined,
    };

    console.log(`[SeedDreamTool][${requestId}] Calling fal-ai/bytedance/seedream/v3/text-to-image with payload:`, falInput);

    const result: any = await fal.subscribe("fal-ai/bytedance/seedream/v3/text-to-image", {
      input: falInput,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs) {
          update.logs.forEach((log) => console.log(`[Fal-Log][${requestId}] ${log.message}`));
        }
      },
    });

    const generatedImages = result?.data?.images;
    if (!generatedImages || generatedImages.length === 0) {
      throw new Error("SeedDream tool failed to generate any images.");
    }

    const uploadPromises = generatedImages.map(async (image: any, index: number) => {
        const imageResponse = await fetch(image.url);
        if (!imageResponse.ok) throw new Error(`Failed to download generated image from ${image.url}`);
        const imageBuffer = await imageResponse.arrayBuffer();
        const mimeType = imageResponse.headers.get('content-type') || 'image/png';

        const filePath = `${invoker_user_id}/${Date.now()}_seedream_${index}.png`;
        await supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: mimeType, upsert: true });
        const { data: { publicUrl } } = supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
        
        const base64Data = encodeBase64(imageBuffer);
        const description = await describeImage(base64Data, mimeType);

        return { storagePath: filePath, publicUrl, description };
    });

    const processedImages = await Promise.all(uploadPromises);
    await supabaseAdmin.rpc('increment_images_generated_count', { p_user_id: invoker_user_id, p_images_to_add: processedImages.length });

    const finalResult = {
      isImageGeneration: true,
      message: `Successfully generated ${processedImages.length} images with SeedDream 3.0.`,
      images: processedImages
    };

    return new Response(JSON.stringify(finalResult), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    console.error(`[SeedDreamTool][${requestId}] UNHANDLED ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});