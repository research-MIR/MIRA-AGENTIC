import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import imageSize from "https://esm.sh/image-size";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro";

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
{
  "person": {
    "y_min": 28,
    "x_min": 362,
    "y_max": 984,
    "x_max": 624
  }
}
\`\`\``;

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        return JSON.parse(match[1]);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

function parseStorageURL(url: string): { bucket: string, path: string } | null {
    try {
        const u = new URL(url);
        // Only attempt to parse if it looks like a Supabase URL
        if (!u.hostname.endsWith('supabase.co')) {
            return null;
        }
        const pathSegments = u.pathname.split('/');
        const objectSegmentIndex = pathSegments.indexOf('object');
        if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
            return null;
        }
        const bucket = pathSegments[objectSegmentIndex + 2];
        const path = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
        if (!bucket || !path) {
            return null;
        }
        return { bucket, path };
    } catch (e) {
        // URL constructor might fail for invalid URLs
        return null;
    }
}

async function getDimensionsAndBuffer(supabase: SupabaseClient, publicUrl: string): Promise<{buffer: Uint8Array, dimensions: {width: number, height: number}, mimeType: string}> {
    const parsed = parseStorageURL(publicUrl);
    let blob: Blob;

    if (parsed) {
        const { bucket, path } = parsed;
        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (error) throw new Error(`Failed to download image from Supabase: ${error.message}`);
        blob = data;
    } else {
        console.log(`[BBox-Worker] URL is not a Supabase URL. Fetching directly: ${publicUrl}`);
        const response = await fetch(publicUrl);
        if (!response.ok) {
            throw new Error(`Failed to download image from external URL: ${response.statusText}`);
        }
        blob = await response.blob();
    }

    const buffer = new Uint8Array(await blob.arrayBuffer());
    const size = imageSize(buffer);
    if (!size || !size.width || !size.height) throw new Error("Could not determine image dimensions from file header.");
    
    return { buffer, dimensions: { width: size.width, height: size.height }, mimeType: blob.type };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { image_url } = await req.json();
    if (!image_url) throw new Error("image_url is required.");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    // 1. Get original dimensions and buffer
    const { buffer: imageBuffer, dimensions: original_dimensions, mimeType } = await getDimensionsAndBuffer(supabase, image_url);
    console.log(`[BBox-Worker] Original dimensions: ${original_dimensions.width}x${original_dimensions.height}`);

    // 2. Base64 encode the image and send to Gemini
    const imageBase64 = encodeBase64(imageBuffer);
    
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { mimeType: mimeType || 'image/png', data: imageBase64 } },
                { text: "Output the position of the person in the image." }
            ]
        }],
        generationConfig: { 
            responseMimeType: "application/json",
        },
        safetySettings,
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    console.log("[BBox-Worker] Full LLM response:", result.text);

    // 3. Parse the response
    const responseJson = extractJson(result.text);
    const detectedBox = responseJson.person;
    if (!detectedBox || detectedBox.y_min === undefined) {
      throw new Error("AI response did not contain a valid 'person' object with coordinates.");
    }
    console.log(`[BBox-Worker] Detected box (normalized to 1000x1000):`, detectedBox);

    // 4. Return the normalized box and original dimensions
    return new Response(JSON.stringify({
      normalized_bounding_box: detectedBox,
      original_dimensions: original_dimensions
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