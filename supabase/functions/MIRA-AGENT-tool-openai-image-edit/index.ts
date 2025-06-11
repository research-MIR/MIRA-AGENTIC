import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decode } from "https://deno.land/std@0.208.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const GENERATED_IMAGES_BUCKET = 'mira-generations';

interface ImageData {
    data: string; // base64 encoded string
    mimeType: string;
    name: string;
}

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `openai-edit-${Date.now()}`;
  console.log(`[OpenAI-Edit][${requestId}] Function invoked.`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  if (!OPENAI_API_KEY) {
    console.error(`[OpenAI-Edit][${requestId}] CRITICAL: Missing OpenAI API key.`);
    return new Response(JSON.stringify({ error: "OpenAI API key not configured." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }

  try {
    const { prompt, images, n = 1, size = "1024x1024", invoker_user_id } = await req.json();

    if (!prompt || !images || images.length === 0 || !invoker_user_id) {
      throw new Error("Prompt, at least one reference image, and invoker_user_id are required.");
    }
    console.log(`[OpenAI-Edit][${requestId}] User ID: ${invoker_user_id}, Images: ${images.length}`);

    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('images_generated_count, image_generation_quota')
      .eq('id', invoker_user_id)
      .single();

    if (profileError) throw new Error(`Failed to check user quota: ${profileError.message}`);
    
    const quotaLimit = profileData.image_generation_quota || 0;
    const currentCount = profileData.images_generated_count || 0;
    if (currentCount + n > quotaLimit) {
      throw new Error(`Quota of ${quotaLimit} images exceeded.`);
    }

    const openAiFormData = new FormData();
    openAiFormData.append("prompt", prompt);
    openAiFormData.append("model", "gpt-image-1");
    openAiFormData.append("n", n.toString());
    openAiFormData.append("size", size);
    // Per docs, response_format is not supported for gpt-image-1 on this endpoint either.
    
    images.forEach((img: ImageData, index: number) => {
      const imageBuffer = decode(img.data);
      const imageBlob = new Blob([imageBuffer], { type: img.mimeType });
      openAiFormData.append(`image`, imageBlob, img.name || `image_${index}.png`);
    });

    console.log(`[OpenAI-Edit][${requestId}] Sending request to OpenAI edits endpoint.`);
    const openaiResponse = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` },
      body: openAiFormData
    });

    const responseData = await openaiResponse.json();
    console.log(`[OpenAI-Edit][${requestId}] Received response from OpenAI. Status: ${openaiResponse.status}`);

    if (!openaiResponse.ok) {
      console.error(`[OpenAI-Edit][${requestId}] OpenAI API Error:`, JSON.stringify(responseData, null, 2));
      throw new Error(responseData.error?.message || "Failed to generate images from OpenAI.");
    }

    if (responseData.data && Array.isArray(responseData.data)) {
      await supabaseAdmin.rpc('increment_images_generated_count', { p_user_id: invoker_user_id, p_images_to_add: responseData.data.length });
    }

    const uploadPromises = responseData.data.map(async (image: { b64_json: string }, index: number) => {
        const imageBuffer = decode(image.b64_json);
        const filePath = `${invoker_user_id}/${Date.now()}_openai_edit_${index}.png`;
        await supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
        const { data: { publicUrl } } = supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
        return { storagePath: filePath, publicUrl };
    });

    const processedImages = await Promise.all(uploadPromises);
    console.log(`[OpenAI-Edit][${requestId}] Successfully uploaded ${processedImages.length} images.`);

    const finalResult = {
        isImageGeneration: true,
        message: `Successfully generated ${processedImages.length} images.`,
        images: processedImages
    };

    return new Response(JSON.stringify(finalResult), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });
  } catch (error) {
    console.error(`[OpenAI-Edit][${requestId}] Edge Function Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});