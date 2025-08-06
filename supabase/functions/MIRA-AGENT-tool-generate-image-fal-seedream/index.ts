// NOTE: This function has been updated to use 'fal-ai/qwen-image' instead of 'seedream'.
// The filename is kept for backward compatibility to avoid changing orchestrator logic.
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

const sizeToQwenEnum: { [key: string]: string } = {
    '1:1': 'square',
    '1024x1024': 'square_hd',
    '3:4': 'portrait_4_3', // Note: Qwen uses W:H format for enums
    '4:3': 'landscape_4_3',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '2:3': 'portrait_4_3', // Closest match
    '3:2': 'landscape_4_3', // Closest match
    '21:9': 'landscape_16_9', // Closest match
    '896x1280': 'portrait_4_3',
    '1280x896': 'landscape_4_3',
    '768x1408': 'portrait_16_9',
    '1408x768': 'landscape_16_9',
};

function mapToQwenImageSize(size?: string): string | { width: number, height: number } {
    if (!size) return "square_hd";
    if (sizeToQwenEnum[size]) {
        return sizeToQwenEnum[size];
    }
    // Handle custom ratios like "21:9"
    if (size.includes(':')) {
        const [w, h] = size.split(':').map(Number);
        if (!isNaN(w) && !isNaN(h) && h > 0) {
            // Scale to a reasonable default resolution while maintaining ratio
            const long_edge = 1344;
            if (w > h) {
                return { width: long_edge, height: Math.round(long_edge * (h / w)) };
            } else {
                return { width: Math.round(long_edge * (w / h)), height: long_edge };
            }
        }
    }
    return 'square_hd';
}

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
  const requestId = req.headers.get("x-request-id") || `agent-qwen-${Date.now()}`;
  console.log(`[QwenTool][${requestId}] Function invoked.`);

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
        negative_prompt: negative_prompt,
        image_size: mapToQwenImageSize(size),
        num_images: finalImageCount,
        seed: seed ? Number(seed) : undefined,
        enable_safety_checker: false,
    };

    console.log(`[QwenTool][${requestId}] Calling fal-ai/qwen-image with payload:`, falInput);

    const result: any = await fal.subscribe("fal-ai/qwen-image", {
      input: falInput,
      logs: true,
      onQueueUpdate: (update) => {
        if (update.status === "IN_PROGRESS" && update.logs) {
          update.logs.forEach((log) => console.log(`[Fal-Log][${requestId}] ${log.message}`));
        }
      },
    });

    console.log(`[QwenTool][${requestId}] Full API response from Fal.ai:`, JSON.stringify(result, null, 2));

    const generatedImages = result?.data?.images;
    if (!generatedImages || generatedImages.length === 0) {
      throw new Error("Qwen tool failed to generate any images.");
    }

    const uploadPromises = generatedImages.map(async (image: any, index: number) => {
        const imageResponse = await fetch(image.url);
        if (!imageResponse.ok) throw new Error(`Failed to download generated image from ${image.url}`);
        const imageBuffer = await imageResponse.arrayBuffer();
        const mimeType = imageResponse.headers.get('content-type') || 'image/png';

        const filePath = `${invoker_user_id}/${Date.now()}_qwen_${index}.png`;
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
      message: `Successfully generated ${processedImages.length} images with Qwen.`,
      images: processedImages
    };

    return new Response(JSON.stringify(finalResult), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    console.error(`[QwenTool][${requestId}] UNHANDLED ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});