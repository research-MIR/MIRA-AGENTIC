import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleAuth } from "npm:google-auth-library";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const GOOGLE_VERTEX_AI_SA_KEY_JSON = Deno.env.get('GOOGLE_VERTEX_AI_SA_KEY_JSON');
const GOOGLE_PROJECT_ID = Deno.env.get('GOOGLE_PROJECT_ID');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const GOOGLE_LOCATION = 'us-central1';
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const MAX_RETRIES = 3; // Increased to 3 for more resilience
const RETRY_DELAY_MS = 1500;

const visionSystemPrompt = "You are an expert image analyst. Your sole task is to describe the provided image in a single, concise sentence. Focus on the main subject, their pose, and key attributes. Do not mention colors or background unless they are critical for identification. Example: 'A woman standing with her hands on her hips, wearing a red dress.'";

async function describeImage(base64Data: string, mimeType: string): Promise<string> {
    if (!GEMINI_API_KEY) {
        console.warn("[ImageDescriber] Missing GEMINI_API_KEY, skipping description.");
        return "No description available.";
    }
    try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash-lite-preview-06-17",
            contents: [{
                role: 'user',
                parts: [{
                    inlineData: {
                        mimeType: mimeType,
                        data: base64Data
                    }
                }, {
                    text: "Describe this image based on the system instructions."
                }]
            }],
            config: {
                systemInstruction: {
                    role: "system",
                    parts: [{ text: visionSystemPrompt }]
                }
            }
        });
        return result.text.trim();
    } catch (error) {
        console.error("[ImageDescriber] Error generating description:", error.message);
        return "Description generation failed.";
    }
}


function mapSizeToGoogleAspectRatio(size?: string): string {
    if (!size) return "1:1";
    const [width, height] = size.split('x').map(Number);
    if (isNaN(width) || isNaN(height)) return "1:1";

    const ratio = width / height;
    const supportedRatios = {
        "1:1": 1,
        "16:9": 16/9,
        "9:16": 9/16,
        "4:3": 4/3,
        "3:4": 3/4
    };

    let closestRatio = "1:1";
    let minDiff = Infinity;

    for (const [key, value] of Object.entries(supportedRatios)) {
        const diff = Math.abs(ratio - value);
        if (diff < minDiff) {
            minDiff = diff;
            closestRatio = key;
        }
    }
    console.log(`[ImageGenerator-Google] Mapped size:${size} (ratio:${ratio}) to closest supported ratio: ${closestRatio}`);
    return closestRatio;
}

serve(async (req)=>{
  const requestId = req.headers.get("x-request-id") || `agent-${Date.now()}`;
  console.log(`[ImageGenerator-Google][${requestId}] Function invoked.`);

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  if (!GOOGLE_VERTEX_AI_SA_KEY_JSON || !GOOGLE_PROJECT_ID || !supabaseAdmin.supabaseUrl || !supabaseAdmin.supabaseKey) {
    console.error(`[ImageGenerator-Google][${requestId}] CRITICAL: Missing environment variables.`);
    return new Response(JSON.stringify({ error: "Server configuration error for AI services." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
  
  try {
    const { prompt, number_of_images, negative_prompt, seed, model_id, invoker_user_id, size } = await req.json();
    console.log(`[ImageGenerator-Google][${requestId}] Received request with prompt: "${prompt.substring(0, 50)}..."`);

    if (!prompt) throw new Error("Prompt is required.");
    if (!invoker_user_id) throw new Error("invoker_user_id is required to attribute image generation.");

    let profile = null;
    let profileError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[ImageGenerator-Google][${requestId}] Attempt ${attempt}/${MAX_RETRIES} to fetch user profile...`);
        const { data, error } = await supabaseAdmin.from('profiles').select('images_generated_count, image_generation_quota').eq('id', invoker_user_id).single();
        if (!error) {
            profile = data;
            profileError = null;
            console.log(`[ImageGenerator-Google][${requestId}] Successfully fetched user profile.`);
            break;
        }
        profileError = error;
        console.warn(`[ImageGenerator-Google][${requestId}] Failed to fetch profile, attempt ${attempt}. Error: ${error.message}. Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }

    if (profileError || !profile) {
        throw new Error(`Could not retrieve user profile after ${MAX_RETRIES} attempts: ${profileError?.message}`);
    }
    
    const finalImageCount = number_of_images || 4;
    if (profile.images_generated_count + finalImageCount > profile.image_generation_quota) {
        throw new Error(`Quota exceeded. User has ${profile.image_generation_quota - profile.images_generated_count} left but requested ${finalImageCount}.`);
    }
    console.log(`[ImageGenerator-Google][${requestId}] Quota check passed for user ${invoker_user_id}.`);

    let finalModelId = model_id;
    if (!finalModelId) {
        const { data: dbModel, error: modelError } = await supabaseAdmin.from('mira-agent-models').select('model_id_string').eq('model_type', 'image').eq('is_default', true).single();
        if (modelError) throw new Error(`Failed to fetch default image model: ${modelError.message}`);
        finalModelId = dbModel.model_id_string;
    }

    // Temporary fix for deprecated model ID
    if (finalModelId === 'imagen-4.0-ultra-generate-exp-05-20') {
        console.log(`[ImageGenerator-Google][${requestId}] Deprecated model ID detected. Swapping to new model.`);
        finalModelId = 'imagen-4.0-ultra-generate-preview-06-06';
    }

    console.log(`[ImageGenerator-Google][${requestId}] Using model: ${finalModelId}`);

    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_VERTEX_AI_SA_KEY_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const accessToken = await auth.getAccessToken();
    const apiUrl = `https://${GOOGLE_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${GOOGLE_LOCATION}/publishers/google/models/${finalModelId}:predict`;
    
    const aspectRatioString = mapSizeToGoogleAspectRatio(size);

    const generationPromises = Array.from({ length: finalImageCount }).map((_, i) => {
      const requestBody = {
        instances: [{ prompt }],
        parameters: { 
            sampleCount: 1, 
            aspectRatio: aspectRatioString, 
            negativePrompt: negative_prompt, 
            seed: seed ? Number(seed) + i : undefined,
            addWatermark: false,
            outputOptions: {
                mimeType: "image/jpeg",
                compressionQuality: 95
            }
        }
      };
      return (async () => {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            console.log(`[ImageGenerator-Google][${requestId}] Calling Vertex AI, attempt ${attempt}/${MAX_RETRIES} for image ${i+1}.`);
            console.log(`[ImageGenerator-Google][${requestId}] Full Request Payload:`, JSON.stringify(requestBody, null, 2));
            const response = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody)
            });
            if (!response.ok) {
                const errorBody = await response.text();
                console.error(`[ImageGenerator-Google][${requestId}] API Error Body:`, errorBody);
                throw new Error(`API call failed with status ${response.status}`);
            }
            const responseData = await response.json();
            return responseData.predictions?.[0];
          } catch (error) {
            console.warn(`[ImageGenerator-Google][${requestId}] Attempt ${attempt} failed for image ${i+1}: ${error.message}`);
            if (attempt === MAX_RETRIES) throw error;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          }
        }
      })();
    });

    const settledResults = await Promise.allSettled(generationPromises);
    const successfulPredictions = settledResults.filter(r => r.status === 'fulfilled' && r.value).map((r: any) => r.value);

    if (successfulPredictions.length === 0) throw new Error("Image generation failed after all retries.");
    console.log(`[ImageGenerator-Google][${requestId}] Successfully generated ${successfulPredictions.length} images.`);

    const uploadPromises = successfulPredictions.map(async (prediction, index) => {
      const imageBuffer = decodeBase64(prediction.bytesBase64Encoded);
      const filePath = `${invoker_user_id}/${Date.now()}_${index}.jpeg`;
      await supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/jpeg', upsert: true });
      const { data: { publicUrl } } = supabaseAdmin.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
      
      // Self-analysis step
      const description = await describeImage(prediction.bytesBase64Encoded, 'image/jpeg');
      console.log(`[ImageGenerator-Google][${requestId}] Generated description for image ${index + 1}: "${description}"`);

      return { storagePath: filePath, publicUrl, description };
    });

    const processedImages = await Promise.all(uploadPromises);
    await supabaseAdmin.rpc('increment_images_generated_count', { p_user_id: invoker_user_id, p_images_to_add: processedImages.length });
    console.log(`[ImageGenerator-Google][${requestId}] Uploaded ${processedImages.length} images to storage and updated user quota.`);

    const finalResult = {
      isImageGeneration: true,
      message: `Successfully generated ${processedImages.length} images.`,
      images: processedImages
    };

    return new Response(JSON.stringify(finalResult), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });

  } catch (error) {
    console.error(`[ImageGenerator-Google][${requestId}] UNHANDLED ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }
});