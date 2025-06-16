import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Type, Part, createPartFromUri } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- EXPERIMENT: Temporarily simplified system prompt ---
const systemPrompt = `You are an image analysis AI. Your task is to analyze the provided image and return a JSON object describing it. The JSON should contain a description and a list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d" and the text label in the key "label". Use descriptive labels.`;

// --- EXPERIMENT: Temporarily simplified response schema (NO MASK) ---
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    'description': {
      type: Type.STRING,
      description: 'A textual description of what you have segmented.',
    },
    'masks': {
        type: Type.ARRAY,
        description: "A list of segmentation masks.",
        items: {
            type: Type.OBJECT,
            properties: {
                'box_2d': {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER },
                    description: "The bounding box of the mask [y_min, x_min, y_max, x_max] normalized to 1000."
                },
                'label': {
                    type: Type.STRING,
                    description: "A descriptive label for the segmented object."
                }
            },
            required: ['box_2d', 'label']
        }
    }
  },
  required: ['description', 'masks'],
};

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) { return JSON.parse(match[1]); }
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  const reqId = `req_${Date.now()}`;
  console.log(`[SegmentAI Log][${reqId}] Function invoked (Experiment: No Mask).`);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { base64_image_data, mime_type, user_id } = await req.json();
    console.log(`[SegmentAI Log][${reqId}] Received request payload for user: ${user_id}.`);

    if (!base64_image_data || !mime_type || !user_id) {
      throw new Error("base64_image_data, mime_type, and user_id are required.");
    }
    console.log(`[SegmentAI Log][${reqId}] Input validated. Mime type: ${mime_type}.`);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    console.log(`[SegmentAI Log][${reqId}] Uploading file to Google Files API...`);
    const imageBuffer = decodeBase64(base64_image_data);
    const imageBlob = new Blob([imageBuffer], { type: mime_type });
    
    const uploadResult = await ai.files.upload({
        file: imageBlob,
        config: { displayName: `segmentation_upload_${reqId}` }
    });
    console.log(`[SegmentAI Log][${reqId}] File upload initiated. File name: ${uploadResult.name}`);

    let file = await ai.files.get({ name: uploadResult.name as string });
    let retries = 0;
    const maxRetries = 10; // Poll for 30 seconds max
    while (file.state === 'PROCESSING' && retries < maxRetries) {
        console.log(`[SegmentAI Log][${reqId}] File is still processing. Retrying in 3 seconds... (Attempt ${retries + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        file = await ai.files.get({ name: uploadResult.name as string });
        retries++;
    }

    if (file.state === 'FAILED') {
        throw new Error('File processing failed on Google\'s side.');
    }
    if (file.state !== 'ACTIVE') {
        throw new Error(`File processing timed out after ${retries * 3} seconds. Last state: ${file.state}`);
    }
    console.log(`[SegmentAI Log][${reqId}] File is now ACTIVE. URI: ${file.uri}`);
    
    const imagePart = createPartFromUri(file.uri, file.mimeType);

    const requestPayload = {
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [imagePart] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        },
        config: {
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }
        }
    };

    console.log(`[SegmentAI Log][${reqId}] Calling Gemini API with file reference...`);
    const result = await ai.models.generateContent(requestPayload);
    console.log(`[SegmentAI Log][${reqId}] Successfully received response from Gemini API.`);

    const rawTextResponse = result.text;
    const responseJson = extractJson(rawTextResponse);
    console.log(`[SegmentAI Log][${reqId}] Successfully parsed JSON. Found ${responseJson.masks?.length || 0} items.`);

    // No post-processing needed in this experiment as we don't have mask data.

    return new Response(JSON.stringify(responseJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[SegmentAI Log][${reqId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});