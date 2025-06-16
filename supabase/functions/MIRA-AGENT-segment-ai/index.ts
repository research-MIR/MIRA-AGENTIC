import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Type, Part, createPartFromUri } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a precise image segmentation AI. Your task is to analyze the provided image and return a JSON object containing a description and ONLY ONE segmentation mask.

### CRITICAL RULES:
1.  **SINGLE MASK ONLY:** You MUST return one and only one item in the 'masks' array.
2.  **COMBINED MASK:** The single mask MUST enclose the main person and their primary garment(s) as a single object. Do not segment individual items of clothing.
3.  **LABEL:** The label for this single mask must be "person_with_garment".

### Example Output:
{
  "description": "A close-up shot of a golden retriever puppy playing in a field of green grass.",
  "masks": [
    {
      "box_2d": [100, 150, 800, 850],
      "label": "person_with_garment",
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
        description: "A list containing a single segmentation mask for the person and their garment.",
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
                    description: "The base64 encoded mask of the segmented object."
                }
            },
            required: ['box_2d', 'label', 'mask']
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
  console.log(`[SegmentAI Log][${reqId}] Function invoked (Downscaling image).`);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { base64_image_data, mime_type, user_id } = await req.json();
    if (!base64_image_data || !mime_type || !user_id) {
      throw new Error("base64_image_data, mime_type, and user_id are required.");
    }

    // --- Image Downscaling Step ---
    console.log(`[SegmentAI Log][${reqId}] Decoding and resizing image...`);
    const originalBuffer = decodeBase64(base64_image_data);
    const image = await Image.decode(originalBuffer);
    image.resize(image.width / 2, Image.RESIZE_AUTO);
    const resizedBuffer = await image.encode(0); // Encode as PNG
    const resizedMimeType = 'image/png';
    console.log(`[SegmentAI Log][${reqId}] Image resized to ${image.width}x${image.height}.`);
    // --- End of Downscaling Step ---

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    console.log(`[SegmentAI Log][${reqId}] Uploading RESIZED file to Google Files API...`);
    const imageBlob = new Blob([resizedBuffer], { type: resizedMimeType });
    
    const uploadResult = await ai.files.upload({
        file: imageBlob,
        config: { displayName: `segmentation_upload_${reqId}` }
    });
    console.log(`[SegmentAI Log][${reqId}] File upload initiated. File name: ${uploadResult.name}`);

    let file = await ai.files.get({ name: uploadResult.name as string });
    let retries = 0;
    const maxRetries = 10;
    while (file.state === 'PROCESSING' && retries < maxRetries) {
        console.log(`[SegmentAI Log][${reqId}] File is still processing. Retrying in 3 seconds... (Attempt ${retries + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 3000));
        file = await ai.files.get({ name: uploadResult.name as string });
        retries++;
    }

    if (file.state !== 'ACTIVE') {
        throw new Error(`File processing timed out or failed. Last state: ${file.state}`);
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

    console.log(`[SegmentAI Log][${reqId}] Calling Gemini API with resized file reference...`);
    const result = await ai.models.generateContent(requestPayload);
    console.log(`[SegmentAI Log][${reqId}] Successfully received response from Gemini API.`);

    const rawTextResponse = result.text;
    const responseJson = extractJson(rawTextResponse);
    console.log(`[SegmentAI Log][${reqId}] Successfully parsed JSON. Found ${responseJson.masks?.length || 0} mask(s).`);

    if (responseJson.masks && responseJson.masks.length > 0) {
        const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
        for (const mask of responseJson.masks) {
            if (mask.mask) {
                const maskBuffer = decodeBase64(mask.mask);
                // Note: This mask corresponds to the DOWNSIZED image.
                // We are not yet upscaling it.
                const filePath = `${user_id}/masks/mask_downscaled_${Date.now()}.png`;
                await supabase.storage.from('mira-agent-user-uploads').upload(filePath, maskBuffer, { contentType: 'image/png', upsert: true });
                const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
                mask.mask_url = publicUrl;
                delete mask.mask;
            }
        }
    }

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