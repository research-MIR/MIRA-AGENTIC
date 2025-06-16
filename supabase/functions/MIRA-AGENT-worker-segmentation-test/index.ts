import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const BUCKET_NAME = 'mira-agent-user-uploads';

const systemPrompt = `You are a precise image segmentation AI. Your task is to analyze the provided image and return a JSON object containing a description and ONLY ONE segmentation mask.

### CRITICAL RULES:
1.  **SINGLE MASK ONLY:** Your final output MUST contain only one item in the 'masks' array.
2.  **COMBINED MASK:** The single mask MUST enclose the main person and their primary garment(s) as a single object. Do not segment individual items of clothing.
3.  **LABEL:** The label for this single mask must be "person_with_garment".

### Example Output:
{
  "description": "A close-up shot of a golden retriever puppy playing in a field of green grass.",
  "masks": [
    {
      "box_2d": [100, 150, 800, 850],
      "label": "person_with_garment"
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
                }
            },
            required: ['box_2d', 'label']
        }
    }
  },
  required: ['description', 'masks'],
};

async function downloadImageAsPart(supabase: SupabaseClient, imageUrl: string): Promise<Part> {
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split(`/public/${BUCKET_NAME}/`);
    if (pathParts.length < 2) {
        throw new Error(`Could not parse storage path from URL: ${imageUrl}`);
    }
    const storagePath = decodeURIComponent(pathParts[1]);
    
    const { data: blob, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(storagePath);

    if (error) {
        throw new Error(`Supabase download failed for path ${storagePath}: ${error.message}`);
    }

    const mimeType = blob.type;
    const buffer = await blob.arrayBuffer();
    const base64 = encodeBase64(buffer);
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
    const { person_image_url, garment_image_url, user_prompt } = await req.json();
    if (!person_image_url) {
      throw new Error("person_image_url is required.");
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

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        }
    });

    const responseJson = extractJson(result.text);
    
    return new Response(JSON.stringify({ success: true, result: responseJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error(`[SegmentationTool Test] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});