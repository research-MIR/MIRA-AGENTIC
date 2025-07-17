import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a high-precision, automated image analysis tool. Your ONLY function is to detect the bounding box of the single, most prominent human subject in the image.

### CRITICAL RULES:
1.  **COMPLETE INCLUSION:** The bounding box MUST enclose the ENTIRE person. This includes every part of their body: head, all of their hair, arms, hands, legs, and feet.
2.  **EDGE-TO-EDGE MANDATE:** If any part of the person is cut off by the image frame (e.g., their feet are not visible at the bottom), the bounding box MUST extend all the way to that edge of the frame. Do not stop short.
3.  **NO CROPPING:** You must not crop any part of the person.

Your entire response MUST be a single, valid JSON object and NOTHING ELSE. Do not include any text, explanations, or markdown formatting like \`\`\`json.

### Example Output Format:
\`\`\`json
[
  {
    "box_2d": [28, 362, 984, 624],
    "label": "person"
  }
]
\`\`\``;

const boundingBoxSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      box_2d: {
        type: "array",
        items: { "type": "number" },
        minItems: 4,
        maxItems: 4,
        description: "The 2D coordinates of the bounding box in [y_min, x_min, y_max, x_max] format."
      },
      label: { 
        type: "string",
        description: "A label for the detected object (e.g., 'person')."
      }
    },
    required: ["box_2d", "label"]
  }
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Uint8Array> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Could not parse bucket name from Supabase URL: ${publicUrl}`);
    }
    const bucketName = pathSegments[objectSegmentIndex + 2];
    const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    if (!bucketName || !filePath) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
    }
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    return new Uint8Array(await data.arrayBuffer());
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { image_url } = await req.json();
    if (!image_url) throw new Error("image_url is required.");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    const imageBuffer = await downloadFromSupabase(supabase, image_url);
    
    const image = await loadImage(imageBuffer);
    const dimensions = { width: image.width(), height: image.height() };

    if (!dimensions || !dimensions.width || !dimensions.height) {
        throw new Error("Could not determine image dimensions.");
    }

    const imageBase64 = encodeBase64(imageBuffer);

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: 'image/png', data: imageBase64 } },
            { text: "Output the position of the person in the image." }
        ] }],
        generationConfig: { 
            responseMimeType: "application/json",
            responseSchema: boundingBoxSchema,
        },
        safetySettings,
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    let detectedBoxes = JSON.parse(result.text);

    if (detectedBoxes && !Array.isArray(detectedBoxes) && detectedBoxes.box_2d) {
        detectedBoxes = [detectedBoxes]; 
    }

    if (!detectedBoxes || !Array.isArray(detectedBoxes) || detectedBoxes.length === 0) {
        throw new Error("AI did not detect any bounding boxes.");
    }

    if (detectedBoxes[0].x !== undefined && detectedBoxes[0].y !== undefined) {
        const box = detectedBoxes[0];
        const y_min_norm = (box.y / dimensions.height) * 1000;
        const x_min_norm = (box.x / dimensions.width) * 1000;
        const y_max_norm = ((box.y + box.height) / dimensions.height) * 1000;
        const x_max_norm = ((box.x + box.width) / dimensions.width) * 1000;
        detectedBoxes[0].box_2d = [y_min_norm, x_min_norm, y_max_norm, x_max_norm];
    }

    if (!detectedBoxes[0].box_2d) {
        throw new Error("AI response did not contain a valid 'box_2d' field.");
    }

    const largestBox = detectedBoxes.reduce((prev, current) => {
        const prevArea = (prev.box_2d[2] - prev.box_2d[0]) * (prev.box_2d[3] - prev.box_2d[1]);
        const currentArea = (current.box_2d[2] - current.box_2d[0]) * (current.box_2d[3] - current.box_2d[1]);
        return (currentArea > prevArea) ? current : prev;
    });

    return new Response(JSON.stringify({
        normalized_bounding_box: largestBox.box_2d,
        original_dimensions: dimensions
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[BBox-Worker] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});