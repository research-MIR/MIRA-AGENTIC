import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Type, Part } from 'https://esm.sh/@google/genai@0.15.0';
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

const systemPrompt = `You are an image analysis AI. Your task is to analyze the provided image and return a JSON object describing it. The JSON should contain a description and a list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label". Use descriptive labels.

Example Output:
{
  "description": "A close-up shot of a golden retriever puppy playing in a field of green grass.",
  "masks": [
    {
      "box_2d": [100, 150, 800, 850],
      "label": "golden_retriever",
      "mask": "iVBORw0KGgoAAAANSUhEUg..."
    }
  ]
}`;

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
                },
                'mask': {
                    type: Type.STRING,
                    description: "A base64 encoded PNG string of the segmentation mask."
                }
            },
            required: ['box_2d', 'label', 'mask']
        }
    }
  },
  required: ['description', 'masks'],
};


function extractJson(text: string): any {
    console.log("[SegmentAI Log] Attempting to parse JSON from text.");
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        console.log("[SegmentAI Log] Found JSON in markdown block. Parsing...");
        const parsed = JSON.parse(match[1]);
        console.log("[SegmentAI Log] Successfully parsed JSON from markdown block.");
        return parsed;
    }
    try {
        console.log("[SegmentAI Log] No markdown block found. Attempting to parse raw text.");
        const parsed = JSON.parse(text);
        console.log("[SegmentAI Log] Successfully parsed raw text as JSON.");
        return parsed;
    } catch (e) {
        console.error("[SegmentAI Log] JSON PARSING FAILED. Raw text was:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  const reqId = `req_${Date.now()}`;
  console.log(`[SegmentAI Log][${reqId}] Function invoked.`);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { base64_image_data, mime_type, user_id } = await req.json();
    console.log(`[SegmentAI Log][${reqId}] Received request payload for user: ${user_id}.`);

    if (!base64_image_data || !mime_type || !user_id) {
      throw new Error("base64_image_data, mime_type, and user_id are required.");
    }
    console.log(`[SegmentAI Log][${reqId}] Input validated. Mime type: ${mime_type}. Base64 data length: ${base64_image_data.length}`);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const imagePart: Part = {
      inlineData: {
        mimeType: mime_type,
        data: base64_image_data,
      },
    };
    
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

    console.log(`[SegmentAI Log][${reqId}] Calling Gemini API with payload (image data omitted for brevity):`, JSON.stringify({ ...requestPayload, contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime_type, data: `...length:${base64_image_data.length}` } }] }] }, null, 2));
    const result = await ai.models.generateContent(requestPayload);

    console.log(`[SegmentAI Log][${reqId}] Received raw response from Gemini API:`, JSON.stringify(result, null, 2));
    const rawTextResponse = result.text;
    console.log(`[SegmentAI Log][${reqId}] Extracted raw text from Gemini response. Length: ${rawTextResponse?.length || 0}`);
    
    const responseJson = extractJson(rawTextResponse);
    console.log(`[SegmentAI Log][${reqId}] Successfully parsed JSON. Found ${responseJson.masks?.length || 0} masks.`);

    console.log(`[SegmentAI Log][${reqId}] Starting post-processing to convert masks to URLs.`);
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    for (const maskItem of responseJson.masks) {
        if (maskItem.mask) {
            console.log(`[SegmentAI Log][${reqId}] Processing mask for label: ${maskItem.label}`);
            const maskBuffer = decodeBase64(maskItem.mask);
            const filePath = `${user_id}/masks/${Date.now()}_${maskItem.label.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
            
            console.log(`[SegmentAI Log][${reqId}] Uploading mask to Supabase Storage at path: ${filePath}`);
            const { error: uploadError } = await supabase.storage
                .from('mira-agent-user-uploads')
                .upload(filePath, maskBuffer, { contentType: 'image/png', upsert: true });

            if (uploadError) {
                console.error(`[SegmentAI Log][${reqId}] Failed to upload mask to storage:`, uploadError);
                continue;
            }

            const { data: { publicUrl } } = supabase.storage
                .from('mira-agent-user-uploads')
                .getPublicUrl(filePath);
            
            maskItem.mask_url = publicUrl;
            delete maskItem.mask;
            console.log(`[SegmentAI Log][${reqId}] Successfully converted mask for '${maskItem.label}' to URL: ${publicUrl}`);
        }
    }
    console.log(`[SegmentAI Log][${reqId}] Finished post-processing.`);
    console.log(`[SegmentAI Log][${reqId}] Final JSON response being sent to client:`, JSON.stringify(responseJson, null, 2));

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