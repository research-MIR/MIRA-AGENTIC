import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-pro-latest";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert image segmentation model. Your task is to identify the main person in the image and provide a segmentation mask and bounding box for them.

### Example Output:
Output a JSON segmentation mask where each entry contains the 2D
bounding box in the key "box_2d", the segmentation mask in key "mask", and
the text label in the key "label". Use descriptive labels.`;

async function downloadImageAsPart(imageUrl: string): Promise<Part> {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const url = new URL(imageUrl);
    const bucketName = url.pathname.split('/')[3];
    const filePath = url.pathname.substring(url.pathname.indexOf(bucketName) + bucketName.length + 1);

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(bucketName).download(filePath);
    if (downloadError) throw new Error(`Supabase download failed: ${downloadError.message}`);

    const mimeType = fileBlob.type;
    const buffer = await fileBlob.arrayBuffer();
    const base64 = encodeBase64(buffer);

    return { inlineData: { mimeType, data: base64 } };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { person_image_url } = await req.json();
    if (!person_image_url) throw new Error("person_image_url is required.");

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const imagePart = await downloadImageAsPart(person_image_url);

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [imagePart] }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = JSON.parse(result.text);

    return new Response(JSON.stringify({ result: responseJson }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[SegmentationWorker] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});