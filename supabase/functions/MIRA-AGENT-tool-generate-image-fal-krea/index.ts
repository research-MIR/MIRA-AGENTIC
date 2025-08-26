import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const FAL_KEY = Deno.env.get('FAL_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

const REQUIRED_LORAS = [
    {
        key: 'v15-bf16',
        source_url: 'https://huggingface.co/jhguighukjghkj/Test/resolve/main/v15-bf16.safetensors',
        params: { scale: 1.0 }
    },
    {
        key: 'fix-v2',
        source_url: 'https://huggingface.co/jhguighukjghkj/Test/resolve/main/fix-v2.safetensors',
        params: { scale: 1.0 }
    }
];

const sizeToKreaEnum: { [key: string]: string } = {
    'square': 'square',
    'square_hd': 'square_hd',
    'portrait_4_3': 'portrait_4_3',
    'landscape_4_3': 'landscape_4_3',
    'landscape_16_9': 'landscape_16_9',
    'portrait_16_9': 'portrait_16_9',
    '1:1': 'square',
    '1024x1024': 'square_hd',
    '3:4': 'portrait_4_3',
    '4:3': 'landscape_4_3',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '2:3': 'portrait_4_3',
    '3:2': 'landscape_4_3',
    '21:9': 'landscape_16_9',
    '896x1280': 'portrait_4_3',
    '1280x896': 'landscape_4_3',
    '768x1408': 'portrait_16_9',
    '1408x768': 'landscape_16_9',
};

function mapToKreaImageSize(size?: string): string | { width: number, height: number } {
    if (!size) return "landscape_4_3";
    if (sizeToKreaEnum[size]) return sizeToKreaEnum[size];
    if (size.includes('x')) {
        const parts = size.split('x').map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
            return { width: parts[0], height: parts[1] };
        }
    }
    if (size.includes(':')) {
        const parts = size.split(':').map(Number);
        if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1]) && parts[0] > 0 && parts[1] > 0) {
            const long_edge = 1440;
            const w = parts[0], h = parts[1];
            return w > h ? { width: long_edge, height: Math.round(long_edge * (h / w)) } : { width: Math.round(long_edge * (w / h)), height: long_edge };
        }
    }
    return "landscape_4_3";
}

async function describeImage(base64Data: string, mimeType: string): Promise<string> {
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
    if (!GEMINI_API_KEY) return "No description available.";
    try {
        const { GoogleGenAI } = await import('https://esm.sh/@google/genai@0.15.0');
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite-preview-06-17",
            contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: base64Data } }] }],
            config: { systemInstruction: { role: "system", parts: [{ text: "Describe this image in a single, concise sentence." }] } }
        });
        return result?.text?.trim() || "Description could not be generated.";
    } catch (error) {
        console.error("[ImageDescriber] Error:", error.message);
        return "Description generation failed.";
    }
}

async function ensureLorasAreCached(supabase: SupabaseClient, logPrefix: string): Promise<any[]> {
    console.log(`${logPrefix} Ensuring all required LoRAs are cached...`);
    const { data: cachedLoras, error: cacheError } = await supabase.from('lora_url_cache').select('*');
    if (cacheError) throw new Error(`Failed to query LoRA cache: ${cacheError.message}`);

    const cacheMap = new Map(cachedLoras.map(l => [l.key, l.fal_url]));
    
    for (const lora of REQUIRED_LORAS) {
        if (!cacheMap.get(lora.key)) {
            console.log(`${logPrefix} Cache miss for '${lora.key}'. Uploading from source: ${lora.source_url}`);
            const uploadedUrl = await fal.storage.upload(new URL(lora.source_url));
            console.log(`${logPrefix} Upload complete for '${lora.key}'. New Fal URL: ${uploadedUrl}`);
            
            const { error: upsertError } = await supabase.from('lora_url_cache').upsert({
                key: lora.key,
                source_url: lora.source_url,
                fal_url: uploadedUrl
            });
            if (upsertError) throw new Error(`Failed to update LoRA cache for '${lora.key}': ${upsertError.message}`);
            cacheMap.set(lora.key, uploadedUrl);
        }
    }
    
    console.log(`${logPrefix} All LoRAs are cached. Assembling payload.`);
    return REQUIRED_LORAS.map(lora => ({
        path: cacheMap.get(lora.key),
        ...lora.params
    }));
}

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `agent-krea-${Date.now()}`;
  console.log(`[KreaTool][${requestId}] Function invoked.`);

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
    const { prompt, number_of_images, negative_prompt, seed, invoker_user_id, size, source } = await req.json();
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
    const lorasPayload = await ensureLorasAreCached(supabaseAdmin, `[KreaTool][${requestId}]`);

    const falInput = {
        prompt: prompt,
        negative_prompt: negative_prompt,
        image_size: mapToKreaImageSize(size),
        num_images: finalImageCount,
        seed: seed ? Number(seed) : undefined,
        enable_safety_checker: false,
        loras: lorasPayload
    };

    console.log(`[KreaTool][${requestId}] Calling fal-ai/flux-krea-lora with payload...`);

    const result: any = await fal.subscribe("fal-ai/flux-krea-lora", {
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
      throw new Error("Krea tool failed to generate any images.");
    }

    const uploadPromises = generatedImages.map(async (image: any, index: number) => {
        const imageResponse = await fetch(image.url);
        if (!imageResponse.ok) throw new Error(`Failed to download generated image from ${image.url}`);
        const imageBuffer = await imageResponse.arrayBuffer();
        const mimeType = image.content_type || 'image/jpeg';

        const filePath = `${invoker_user_id}/${Date.now()}_krea_${index}.jpg`;
        await supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: mimeType, upsert: true });
        const { data: { publicUrl } } = supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
        
        const base64Data = encodeBase64(imageBuffer);
        const description = source !== 'direct_generator'
            ? await describeImage(base64Data, mimeType)
            : "Generated directly.";

        return { storagePath: filePath, publicUrl, description };
    });

    const processedImages = await Promise.all(uploadPromises);
    await supabaseAdmin.rpc('increment_images_generated_count', { p_user_id: invoker_user_id, p_images_to_add: processedImages.length });

    const finalResult = {
      isImageGeneration: true,
      message: `Successfully generated ${processedImages.length} images with FLUX.1 Krea.`,
      images: processedImages
    };

    return new Response(JSON.stringify(finalResult), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    console.error(`[KreaTool][${requestId}] UNHANDLED ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});