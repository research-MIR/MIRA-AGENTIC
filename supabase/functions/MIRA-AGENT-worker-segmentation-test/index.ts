import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64, decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const BUCKET_NAME = 'mira-agent-user-uploads';

const systemPrompt = `You are a virtual stylist and expert image analyst. Your goal is to determine the precise placement of a new garment onto a person in an image by generating a segmentation mask. This is for a high-fidelity virtual try-on, so the mask you create will be used to inpaint the new garment. Accuracy and context are paramount.

---
### Your Task

You will be given one or two images and a user prompt. Your task is to output a single JSON object with a textual description and ONLY ONE segmentation mask based on the user's request and a complex set of rules.

---
### CRITICAL MASK GENERATION RULES

1.  **SINGLE MASK ONLY:** Your final output MUST contain only ONE bounding box and ONE corresponding pixel mask.
2.  **GARMENT ANALYSIS:** If a garment image is provided, you must first analyze it to understand its type (e.g., jacket, dress, pants), material, and fit.
3.  **PERSON ANALYSIS:** Analyze the person's pose and their existing clothing.
4.  **HYPOTHETICAL PLACEMENT:** Your main task is to generate a mask on the person image that represents where the NEW garment would go.
5.  **COVER-UP RULE:** The generated mask MUST be slightly larger than the area of any existing garment it is intended to replace. This ensures full coverage for clean inpainting. For example, if placing a new t-shirt over an old one, the mask must completely cover the old t-shirt.
6.  **INVENTION RULE:** If a user wants to place an upper-body garment (e.g., a shirt) on a person wearing a one-piece (e.g., a dress), you must logically deduce the area for the shirt mask. Your description should note that a lower-body garment would need to be imagined to complete the outfit, but the mask should ONLY be for the new upper-body item.
7.  **PERSON SEGMENTATION (Fallback):** If only a person image is provided and the prompt asks to "find the person" or "segment the person", you MUST create a tight bounding box around the entire person, from head to toe, ignoring the background.
8.  **LABEL:** The label for the mask must be "inpainting_mask_area".
9.  **PIXEL MASK:** You MUST include a base64 encoded PNG string for the \`mask\` property.

---
### JSON Output Format

Your entire response MUST be a single, valid JSON object.

\`\`\`json
{
  "description": "A textual description of your reasoning. For example: 'Generated a mask for the new jacket, assuming it will be worn over the existing t-shirt and ensuring full coverage.'",
  "masks": [
    {
      "box_2d": [100, 150, 800, 850],
      "label": "inpainting_mask_area",
      "mask": "iVBORw0KGgoAAAANSUhEUg..."
    }
  ]
}
\`\`\`
`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    'description': {
      type: Type.STRING,
      description: 'A textual description of what you have segmented and your reasoning.',
    },
    'masks': {
        type: Type.ARRAY,
        description: "A list containing a single segmentation mask for the target area.",
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

async function downloadImageAsPart(supabase: SupabaseClient, imageUrl: string): Promise<Part> {
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split(`/storage/v1/object/public/${BUCKET_NAME}/`);
    if (pathParts.length < 2) {
        throw new Error(`Could not parse storage path from URL: ${imageUrl}`);
    }
    const storagePath = decodeURIComponent(pathParts[1]);
    console.log(`[SegmentationWorker Test] Downloading image from storage path: ${storagePath}`);
    
    const { data: blob, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(storagePath);

    if (error) {
        throw new Error(`Supabase download failed for path ${storagePath}: ${error.message}`);
    }

    const mimeType = blob.type;
    const buffer = await blob.arrayBuffer();
    const base64 = encodeBase64(buffer);
    console.log(`[SegmentationWorker Test] Successfully downloaded and encoded image. Mime-type: ${mimeType}, Size: ${buffer.byteLength} bytes.`);
    return { inlineData: { mimeType, data: base64 } };
}

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) { return JSON.parse(match[1]); }
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { person_image_url, garment_image_url, user_prompt, user_id } = await req.json();
    console.log(`[SegmentationWorker Test] Invoked with user_id: ${user_id}`);
    if (!person_image_url || !user_id) {
      throw new Error("person_image_url and user_id are required.");
    }
    
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const userParts: Part[] = [
        { text: "Person Image:" },
        await downloadImageAsPart(supabase, person_image_url),
    ];

    if (garment_image_url) {
        userParts.push({ text: "Garment Image:" });
        userParts.push(await downloadImageAsPart(supabase, garment_image_url));
    }

    userParts.push({ text: `User instructions: ${user_prompt || 'None'}` });

    console.log(`[SegmentationWorker Test] Calling Gemini with ${userParts.length} parts.`);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        },
        config: {
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }
        }
    });

    const responseJson = extractJson(result.text);
    console.log(`[SegmentationWorker Test] Received and parsed JSON response. Found ${responseJson.masks?.length || 0} mask(s).`);

    if (responseJson.masks && responseJson.masks.length > 0 && responseJson.masks[0].mask) {
        let maskBase64 = responseJson.masks[0].mask;
        
        const prefix = 'data:image/png;base64,';
        if (maskBase64.startsWith(prefix)) {
            console.log("[SegmentationTool Test] Stripping data URI prefix from mask data.");
            maskBase64 = maskBase64.substring(prefix.length);
        }

        const maskBuffer = decodeBase64(maskBase64);
        const filePath = `${user_id}/masks/mask_${Date.now()}.png`;
        
        await supabase.storage
            .from('mira-agent-user-uploads')
            .upload(filePath, maskBuffer, { contentType: 'image/png', upsert: true });
            
        const { data: { publicUrl } } = supabase.storage
            .from('mira-agent-user-uploads')
            .getPublicUrl(filePath);
            
        responseJson.masks[0].mask_url = publicUrl;
        console.log(`[SegmentationWorker Test] Uploaded mask to: ${publicUrl}`);
    }
    
    return new Response(JSON.stringify({ success: true, result: responseJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error(`[SegmentationTool Test] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});