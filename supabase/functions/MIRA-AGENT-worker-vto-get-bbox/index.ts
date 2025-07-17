import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import imageSize from "https://esm.sh/image-size";

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

async function getDimensionsFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<{width: number, height: number}> {
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

    // Download only the first 64KB, which is more than enough for image headers.
    const { data: fileHead, error } = await supabase.storage.from(bucketName).download(filePath, { range: '0-65535' });
    if (error) throw new Error(`Failed to download image header: ${error.message}`);

    const buffer = new Uint8Array(await fileHead.arrayBuffer());
    const size = imageSize(buffer);
    if (!size || !size.width || !size.height) throw new Error("Could not determine image dimensions from file header.");
    
    return { width: size.width, height: size.height };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { image_url } = await req.json();
    if (!image_url) throw new Error("image_url is required.");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    // 1. Get original dimensions without loading the full image
    const original_dimensions = await getDimensionsFromSupabase(supabase, image_url);
    console.log(`[BBox-Worker] Original dimensions: ${original_dimensions.width}x${original_dimensions.height}`);

    // 2. Create a resized image URL and download the smaller version
    const RESIZE_DIMENSION = 512;
    const resizedUrl = `${image_url}?width=${RESIZE_DIMENSION}&height=${RESIZE_DIMENSION}&resize=contain`;
    console.log(`[BBox-Worker] Fetching resized image from: ${resizedUrl}`);
    
    const resizedResponse = await fetch(resizedUrl);
    if (!resizedResponse.ok) {
        throw new Error(`Failed to fetch resized image: ${resizedResponse.statusText}`);
    }
    const resizedImageBuffer = new Uint8Array(await resizedResponse.arrayBuffer());
    
    // 3. Get dimensions of the resized image
    const resized_dimensions = imageSize(resizedImageBuffer);
    if (!resized_dimensions || !resized_dimensions.width || !resized_dimensions.height) {
        throw new Error("Could not determine resized image dimensions.");
    }
    console.log(`[BBox-Worker] Resized dimensions: ${resized_dimensions.width}x${resized_dimensions.height}`);

    // 4. Base64 encode the SMALL image and send to Gemini
    const imageBase64 = encodeBase64(resizedImageBuffer);
    
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { mimeType: 'image/webp', data: imageBase64 } },
                { text: "Output the position of the person in the image." }
            ]
        }],
        generationConfig: { 
            responseMimeType: "application/json",
        },
        safetySettings,
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    // 5. Parse the response and scale the coordinates
    const detectedBox = JSON.parse(result.text).person;
    if (!detectedBox || detectedBox.y_min === undefined) {
      throw new Error("AI response did not contain a valid 'person' object with coordinates.");
    }
    console.log(`[BBox-Worker] Detected box (normalized to 1000x1000 on resized image):`, detectedBox);

    const scaleX = original_dimensions.width / resized_dimensions.width;
    const scaleY = original_dimensions.height / resized_dimensions.height;

    const finalBox = {
        y_min: Math.round(detectedBox.y_min * scaleY),
        x_min: Math.round(detectedBox.x_min * scaleX),
        y_max: Math.round(detectedBox.y_max * scaleY),
        x_max: Math.round(detectedBox.x_max * scaleX),
    };
    console.log(`[BBox-Worker] Scaled box (normalized to 1000x1000 on original image):`, finalBox);

    // 6. Return the final, scaled box and original dimensions
    return new Response(JSON.stringify({
      normalized_bounding_box: finalBox,
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