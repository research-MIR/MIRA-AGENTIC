import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Virtual Try-On Analyst" AI. Your task is to analyze two images: a "Person Image" and a "Garment Image".

Your goal is to identify the garment in the "Garment Image" and determine where it should be placed on the person in the "Person Image".

You MUST return a single, valid JSON object containing a list named "segmentation_masks". Each item in the list should have the following structure:
{
  "label": "A brief description of the item in the Garment Image.",
  "box_2d": [Y_MIN, X_MIN, Y_MAX, X_MAX],
  "mask": "BASE64_ENCODED_PNG_STRING"
}

- "box_2d": An array of four numbers representing the bounding box of the garment on the PERSON, normalized to 1000x1000.
- "mask": A base64 encoded string of a PNG image representing the segmentation mask of the garment.

Analyze the images and provide the JSON output.`;

async function downloadImageAsPart(supabase: SupabaseClient, imageUrl: string, label: string): Promise<Part[]> {
    const url = new URL(imageUrl);
    const bucketName = 'mira-agent-user-uploads';
    const filePath = url.pathname.split(`/${bucketName}/`)[1];
    if (!filePath) throw new Error(`Could not parse file path from URL: ${imageUrl}`);

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(bucketName).download(filePath);
    if (downloadError) throw new Error(`Supabase download failed for ${filePath}: ${downloadError.message}`);

    const mimeType = fileBlob.type;
    const buffer = await fileBlob.arrayBuffer();
    const base64 = encodeBase64(buffer);

    return [
        { text: `--- ${label} ---` },
        { inlineData: { mimeType, data: base64 } }
    ];
}

function extractJson(text: string): any {
    // First, try to find a JSON markdown block
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        try {
            return JSON.parse(match[1]);
        } catch (e) {
            console.error("Failed to parse JSON from markdown block, will try other methods. Error:", e.message);
        }
    }

    // If markdown block fails or doesn't exist, try to parse the whole text
    try {
        return JSON.parse(text);
    } catch (e) {
        // If that fails, find the first '{' and last '}' and try to parse that substring
        const firstBrace = text.indexOf('{');
        const lastBrace = text.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            const jsonSubstring = text.substring(firstBrace, lastBrace + 1);
            try {
                return JSON.parse(jsonSubstring);
            } catch (subError) {
                console.error("Failed to parse JSON substring. Substring was:", jsonSubstring);
                // Fall through to the final error
            }
        }
    }

    // If all attempts fail, throw the final error
    console.error("All JSON parsing attempts failed. Raw text was:", text);
    throw new Error("The model returned a response that could not be parsed as JSON.");
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });
  }

  console.log(`[SegmentationWorker][${job_id}] Invoked.`);
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    console.log(`[SegmentationWorker][${job_id}] Fetching job details...`);
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-segmentation-jobs')
      .select('person_image_url, garment_image_url, user_prompt')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    console.log(`[SegmentationWorker][${job_id}] Job details fetched successfully.`);

    console.log(`[SegmentationWorker][${job_id}] Downloading person image from: ${job.person_image_url}`);
    const personParts = await downloadImageAsPart(supabase, job.person_image_url, "Person Image");
    console.log(`[SegmentationWorker][${job_id}] Person image downloaded.`);

    console.log(`[SegmentationWorker][${job_id}] Downloading garment image from: ${job.garment_image_url}`);
    const garmentParts = await downloadImageAsPart(supabase, job.garment_image_url, "Garment Image");
    console.log(`[SegmentationWorker][${job_id}] Garment image downloaded.`);

    const userParts: Part[] = [
        ...personParts,
        ...garmentParts
    ];

    if (job.user_prompt) {
        userParts.push({ text: `Additional user instructions: ${job.user_prompt}` });
    }

    console.log(`[SegmentationWorker][${job_id}] Calling Gemini model...`);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });
    console.log(`[SegmentationWorker][${job_id}] Received response from Gemini.`);

    const responseJson = extractJson(result.text);

    console.log(`[SegmentationWorker][${job_id}] Updating job status to 'complete'.`);
    await supabase.from('mira-agent-segmentation-jobs').update({
      status: 'complete',
      result: responseJson,
      error_message: null
    }).eq('id', job_id);

    return new Response(JSON.stringify({ success: true, result: responseJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error(`[SegmentationWorker][${job_id}] Error:`, error);
    await supabase.from('mira-agent-segmentation-jobs').update({
      status: 'failed',
      error_message: error.message
    }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});