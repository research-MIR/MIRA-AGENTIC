import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64, decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const BUCKET_NAME = 'mira-agent-user-uploads';

const systemPrompt = `You are a precise image segmentation AI. Your task is to analyze the provided image and return a JSON object containing a description and ONLY ONE segmentation mask.

### CRITICAL RULES:
1.  **SINGLE MASK ONLY:** Your final output MUST contain only ONE item in the 'masks' array.
2.  **COMBINED MASK:** The single mask MUST enclose the main person and their primary garment(s) as a single object. Do not segment individual items of clothing.
3.  **LABEL:** The label for this single mask must be "person_with_garment".
4.  **PIXEL MASK:** You MUST include the pixel mask data in the 'mask' property.

### TASK :
  Give the segmentation masks requested by the ruleset.
  Output a JSON list of segmentation masks where each entry contains the 2D
  bounding box in the key "box_2d", the segmentation mask in key "mask", and
  the text label in the key "label". Use descriptive labels.
  `;

async function downloadImageAsPart(supabase: any, imageUrl: any) {
  const url = new URL(imageUrl);
  const pathParts = url.pathname.split(`/public/${BUCKET_NAME}/`);
  if (pathParts.length < 2) {
    throw new Error(`Could not parse storage path from URL: ${imageUrl}`);
  }
  const storagePath = decodeURIComponent(pathParts[1]);
  console.log(`[SegTestWorker] Downloading image from storage path: ${storagePath}`);
  const { data: blob, error } = await supabase.storage.from(BUCKET_NAME).download(storagePath);
  if (error) {
    throw new Error(`Supabase download failed for path ${storagePath}: ${error.message}`);
  }
  const mimeType = blob.type;
  const buffer = await blob.arrayBuffer();
  const base64 = encodeBase64(buffer);
  console.log(`[SegTestWorker] Successfully downloaded and encoded image. Mime-type: ${mimeType}, Size: ${buffer.byteLength} bytes.`);
  return {
    inlineData: {
      mimeType,
      data: base64
    }
  };
}

function extractJson(text: any) {
  console.log("[SegTestWorker] Attempting to extract JSON from model response.");
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    console.log("[SegTestWorker] Found JSON in markdown block.");
    return JSON.parse(match[1]);
  }
  try {
    console.log("[SegTestWorker] Attempting to parse raw text as JSON.");
    return JSON.parse(text);
  } catch (e) {
    console.error("[SegTestWorker] Failed to parse JSON. Raw text:", text);
    throw new Error("The model returned a response that could not be parsed as JSON.");
  }
}

serve(async (req: any)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { person_image_url, garment_image_url, user_prompt, user_id } = await req.json();
    console.log("[SegTestWorker] Function invoked with payload:", {
      person_image_url,
      garment_image_url,
      user_prompt,
      user_id
    });
    if (!person_image_url || !user_id) {
      throw new Error("person_image_url and user_id are required.");
    }
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const userParts = [
      {
        text: "Person Image:"
      },
      await downloadImageAsPart(supabase, person_image_url)
    ];
    if (garment_image_url) {
      userParts.push({
        text: "Garment Image:"
      });
      userParts.push(await downloadImageAsPart(supabase, garment_image_url));
    }
    userParts.push({
      text: `User instructions: ${user_prompt || 'None'}`
    });
    console.log(`[SegTestWorker] Assembled ${userParts.length} parts for the Gemini request.`);
    const ai = new GoogleGenAI(GEMINI_API_KEY!);
    console.log("[SegTestWorker] Calling Gemini API...");
    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          role: 'user',
          parts: userParts
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      },
      config: {
        systemInstruction: {
          role: "system",
          parts: [
            {
              text: systemPrompt
            }
          ]
        }
      }
    });
    console.log("[SegTestWorker] Received response from Gemini. Raw text length:", result.text.length);
    const responseJson = extractJson(result.text);
    console.log("[SegTestWorker] Successfully parsed JSON. Found masks:", responseJson.masks?.length || 0);
    if (responseJson.masks && responseJson.masks.length > 0 && responseJson.masks[0].mask) {
      const maskBase64 = responseJson.masks[0].mask;
      const maskBuffer = decodeBase64(maskBase64);
      const filePath = `${user_id}/masks/mask_${Date.now()}.png`;
      console.log(`[SegTestWorker] Uploading mask to Supabase storage at: ${filePath}`);
      await supabase.storage.from('mira-agent-user-uploads').upload(filePath, maskBuffer, {
        contentType: 'image/png',
        upsert: true
      });
      const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
      responseJson.masks[0].mask_url = publicUrl;
      console.log(`[SegTestWorker] Mask uploaded. Public URL: ${publicUrl}`);
    }
    console.log("[SegTestWorker] Function finished successfully.");
    return new Response(JSON.stringify({
      success: true,
      result: responseJson
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 200
    });
  } catch (error) {
    console.error(`[SegTestWorker] Unhandled Error:`, error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});