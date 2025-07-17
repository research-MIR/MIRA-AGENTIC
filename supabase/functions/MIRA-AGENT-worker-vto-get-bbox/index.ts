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

const systemPrompt = `You are a high-precision, automated image analysis tool. Your ONLY function is to detect the bounding box of the single, most prominent human subject in the image. The bounding box should tightly enclose the entire person from the top of their head to the bottom of their feet. Your entire response MUST be a single, valid JSON object and NOTHING ELSE. Do not include any text, explanations, or markdown formatting like \`\`\`json.`;

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
    const { width: originalWidth, height: originalHeight } = dimensions;

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

    console.log("Raw response from Gemini:", result.text);

    let detectedBoxes = JSON.parse(result.text);

    if (detectedBoxes && !Array.isArray(detectedBoxes) && detectedBoxes.box_2d) {
        console.log("Model returned a single object, wrapping it in an array.");
        detectedBoxes = [detectedBoxes]; 
    }

    if (!detectedBoxes || !Array.isArray(detectedBoxes) || detectedBoxes.length === 0) {
        throw new Error("AI did not detect any bounding boxes.");
    }

    const largestBox = detectedBoxes.reduce((prev, current) => {
        const prevArea = (prev.box_2d[2] - prev.box_2d[0]) * (prev.box_2d[3] - prev.box_2d[1]);
        const currentArea = (current.box_2d[2] - current.box_2d[0]) * (current.box_2d[3] - current.box_2d[1]);
        return (currentArea > prevArea) ? current : prev;
    });

    const normalizedBox = largestBox.box_2d;

    const [y_min, x_min, y_max, x_max] = normalizedBox;
    const absolute_bounding_box = {
        x: Math.round((x_min / 1000) * originalWidth),
        y: Math.round((y_min / 1000) * originalHeight),
        width: Math.round(((x_max - x_min) / 1000) * originalWidth),
        height: Math.round(((y_max - y_min) / 1000) * originalHeight),
    };

    return new Response(JSON.stringify({
        normalized_bounding_box: normalizedBox,
        absolute_bounding_box: absolute_bounding_box,
        original_dimensions: { width: originalWidth, height: originalHeight }
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