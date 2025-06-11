import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decode } from "https://deno.land/std@0.208.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const VALID_SIZES = ['1024x1024', '1024x1536', '1536x1024', 'auto'];

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `openai-gen-${Date.now()}`;
  console.log(`[OpenAI-Gen][${requestId}] Function invoked.`);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  if (!OPENAI_API_KEY) {
    console.error(`[OpenAI-Gen][${requestId}] CRITICAL: Missing OpenAI API key.`);
    return new Response(JSON.stringify({ error: "OpenAI API key not configured." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }

  try {
    const { prompt, model_id = "gpt-image-1", number_of_images = 1, size = "1024x1024", quality = "high", background = "auto", invoker_user_id } = await req.json();
    console.log(`[OpenAI-Gen][${requestId}] User ID: ${invoker_user_id}, Model: ${model_id}`);

    if (!prompt || !invoker_user_id) {
      throw new Error("Prompt and invoker_user_id are required.");
    }

    let finalSize = size;
    if (!VALID_SIZES.includes(size)) {
        console.warn(`[OpenAI-Gen][${requestId}] Invalid size '${size}' received. Falling back to '1024x1024'.`);
        finalSize = '1024x1024';
    }

    const { data: profileData, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('images_generated_count, image_generation_quota')
      .eq('id', invoker_user_id)
      .single();

    if (profileError) throw new Error(`Failed to check user quota: ${profileError.message}`);
    
    const currentCount = profileData.images_generated_count || 0;
    if (currentCount + number_of_images > profileData.image_generation_quota) {
      throw new Error(`Quota exceeded. User has ${profileData.image_generation_quota - currentCount} generations left but requested ${number_of_images}.`);
    }

    const requestBody: any = {
      model: model_id,
      prompt: prompt,
      n: number_of_images,
      size: finalSize,
      quality: quality,
      background: background,
      moderation: "low",
    };
    
    console.log(`[OpenAI-Gen][${requestId}] Sending request to OpenAI:`, JSON.stringify(requestBody, null, 2));

    const openaiResponse = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    const responseData = await openaiResponse.json();
    console.log(`[OpenAI-Gen][${requestId}] Received response from OpenAI. Status: ${openaiResponse.status}`);

    if (!openaiResponse.ok) {
      console.error(`[OpenAI-Gen][${requestId}] OpenAI API Error:`, JSON.stringify(responseData, null, 2));
      if (responseData.error?.code === 'moderation_blocked') {
        return new Response(JSON.stringify({ error: 'moderation_blocked', message: responseData.error.message }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200 // Return 200 so the master worker can handle this specific error
        });
      }
      throw new Error(responseData.error?.message || "Failed to generate images from OpenAI.");
    }

    const uploadPromises = responseData.data.map(async (image: { b64_json: string }, index: number) => {
        const imageBuffer = decode(image.b64_json);
        const filePath = `${invoker_user_id}/${Date.now()}_openai_generate_${index}.png`;
        await supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
        const { data: { publicUrl } } = supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
        return { storagePath: filePath, publicUrl };
    });

    const processedImages = await Promise.all(uploadPromises);
    await supabaseAdmin.rpc('increment_images_generated_count', { p_user_id: invoker_user_id, p_images_to_add: processedImages.length });
    console.log(`[OpenAI-Gen][${requestId}] Successfully uploaded ${processedImages.length} images.`);

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
    console.error(`[OpenAI-Gen][${requestId}] Edge Function Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});