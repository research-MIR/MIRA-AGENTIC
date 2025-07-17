import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a high-precision, automated image analysis tool. Your ONLY function is to detect the bounding box of the single, most prominent human subject in a given image. Your entire response MUST be a single, valid JSON object with one key, "normalized_bounding_box". The value for "normalized_bounding_box" MUST be an array of four numbers between 0 and 1000, representing the coordinates on a 1000x1000 grid in the format: [y_min, x_min, y_max, x_max]. Do NOT include any other text or explanations.`;

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

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
        contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: imageBase64 } }] }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const normalizedBox = responseJson.normalized_bounding_box;

    if (!normalizedBox || !Array.isArray(normalizedBox) || normalizedBox.length !== 4) {
        throw new Error("AI did not return a valid bounding box.");
    }

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