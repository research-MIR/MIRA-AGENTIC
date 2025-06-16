import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Type, Part } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

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
    const { base64_image_data, mime_type } = await req.json();
    if (!base64_image_data || !mime_type) {
      throw new Error("base64_image_data and mime_type are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const imagePart: Part = {
      inlineData: {
        mimeType: mime_type,
        data: base64_image_data,
      },
    };

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [imagePart] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        },
        config: {
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }
        }
    });

    const responseJson = extractJson(result.text);

    return new Response(JSON.stringify(responseJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[SegmentAI] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});