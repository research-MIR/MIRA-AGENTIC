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

const systemPrompt = `You are a virtual stylist. You will be given two images: one of a person and one of a garment. Your task is to describe exactly where the garment would be placed on the person's body if they were to wear it. Be descriptive and clear. If the user provides additional instructions, take them into account.

In addition to the description, you MUST provide segmentation masks for the garment on the person. Output a JSON object containing both the textual description and a list of segmentation masks. Each mask entry in the list should contain the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label". Use descriptive labels.`;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    'description': {
      type: Type.STRING,
      description: 'A textual description of where the garment would be placed on the person.',
    },
    'masks': {
        type: Type.ARRAY,
        description: "A list of segmentation masks for the garment.",
        items: {
            type: Type.OBJECT,
            properties: {
                'box_2d': {
                    type: Type.ARRAY,
                    items: { type: Type.NUMBER },
                    description: "The bounding box of the mask [y_min, x_min, y_max, x_max] normalized to 1000."
                },
                'mask': {
                    type: Type.STRING,
                    description: "The segmentation mask as a base64 encoded PNG string."
                },
                'label': {
                    type: Type.STRING,
                    description: "A descriptive label for the segmented object."
                }
            },
            required: ['box_2d', 'mask', 'label']
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
    console.log(`[SegmentationWorker] Downloading image from storage path: ${storagePath}`);

    const { data: blob, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(storagePath);

    if (error) {
        throw new Error(`Supabase download failed for path ${storagePath}: ${error.message}`);
    }

    const mimeType = blob.type;
    const buffer = await blob.arrayBuffer();
    const base64 = encodeBase64(buffer);
    console.log(`[SegmentationWorker] Successfully downloaded and encoded image. Mime-type: ${mimeType}, Size: ${buffer.byteLength} bytes.`);
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

  const { job_id } = await req.json();
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });
  }
  console.log(`[SegmentationWorker][${job_id}] Invoked.`);

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    console.log(`[SegmentationWorker][${job_id}] Setting job status to 'processing'.`);
    await supabase.from('mira-agent-segmentation-jobs').update({ status: 'processing' }).eq('id', job_id);

    console.log(`[SegmentationWorker][${job_id}] Fetching job details.`);
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-segmentation-jobs')
      .select('person_image_url, garment_image_url, user_prompt')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    console.log(`[SegmentationWorker][${job_id}] Fetched job details. Person: ${job.person_image_url}, Garment: ${job.garment_image_url}`);

    const personImagePart = await downloadImageAsPart(supabase, job.person_image_url);
    const garmentImagePart = await downloadImageAsPart(supabase, job.garment_image_url);

    const userParts: Part[] = [
        { text: "Person Image:" },
        personImagePart,
        { text: "Garment Image:" },
        garmentImagePart,
        { text: `User instructions: ${job.user_prompt || 'None'}` }
    ];

    console.log(`[SegmentationWorker][${job_id}] All images downloaded. Calling Gemini model...`);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: userParts }],
        config: {
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
            responseMimeType: 'application/json',
            responseSchema: responseSchema,
        }
    });

    console.log(`[SegmentationWorker][${job_id}] Received response from Gemini. Parsing JSON.`);
    const responseJson = extractJson(result.text);
    console.log(`[SegmentationWorker][${job_id}] JSON parsed successfully. Description: "${responseJson.description.substring(0, 50)}...", Masks found: ${responseJson.masks.length}`);

    console.log(`[SegmentationWorker][${job_id}] Updating job status to 'complete' with final result.`);
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