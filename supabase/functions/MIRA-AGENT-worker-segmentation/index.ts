import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const NUM_WORKERS = 5; // Must match the orchestrator

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const systemPrompt = `You are an expert image analyst specializing in fashion segmentation. Your task is to find a garment in a SOURCE image that is visually similar to a garment in a REFERENCE image and create a highly precise segmentation mask for **only that specific garment**.

### Core Rules:
1.  **Identify the Reference:** Look at the REFERENCE image to understand the target garment's category and appearance (e.g., "a t-shirt", "a pair of jeans", "a blazer").
2.  **Find in Source:** Locate the corresponding garment in the SOURCE image.
3.  **Precision is Paramount:** Create a precise segmentation mask for the garment you found in the SOURCE image.
4.  **Prioritize Complete Coverage:** Your primary goal is to cover the *entire* target garment. It is acceptable for the mask to slightly bleed over onto non-garment areas (like skin or background) if it ensures the whole garment is selected. However, the mask **MUST NOT** overlap with any other piece of clothing. Do not leave any part of the target garment unmasked.

### Output Format:
Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label".`;

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        console.error("[SegmentWorker] Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { aggregation_job_id, mime_type, reference_image_base64, reference_mime_type } = await req.json();
  const requestId = `segment-worker-${aggregation_job_id}-${Math.random().toString(36).substring(2, 8)}`;
  console.log(`[SegmentWorker][${requestId}] Invoked for aggregation job ${aggregation_job_id}.`);
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    if (!aggregation_job_id) {
      throw new Error("aggregation_job_id is required.");
    }

    const { data: jobData, error: fetchError } = await supabase
        .from('mira-agent-mask-aggregation-jobs')
        .select('source_image_base64')
        .eq('id', aggregation_job_id)
        .single();
    
    if (fetchError) throw fetchError;
    if (!jobData || !jobData.source_image_base64) {
        throw new Error(`Could not retrieve source image data for job ${aggregation_job_id}`);
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const userParts: Part[] = [
        { text: "SOURCE IMAGE:" },
        { inlineData: { mimeType: mime_type, data: jobData.source_image_base64 } },
    ];

    if (reference_image_base64 && reference_mime_type) {
        userParts.push(
            { text: "REFERENCE IMAGE:" },
            { inlineData: { mimeType: reference_mime_type, data: reference_image_base64 } }
        );
    }

    userParts.push({ text: systemPrompt });
    const contents: Content[] = [{ role: 'user', parts: userParts }];

    console.log(`[SegmentWorker][${requestId}] Calling Gemini API...`);
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
        generationConfig: { responseMimeType: "application/json" },
        safetySettings,
    });
    
    console.log(`[SegmentWorker][${requestId}] Raw response from Gemini:`, result.text);

    let responseToStore;
    try {
        const responseJson = extractJson(result.text);
        if (!responseJson || !Array.isArray(responseJson) || responseJson.length === 0) {
            throw new Error("Model returned a valid JSON but it did not contain a mask array.");
        }
        responseToStore = responseJson;
        console.log(`[SegmentWorker][${requestId}] Successfully parsed JSON. Found ${responseJson.length} masks.`);
    } catch (parsingError) {
        console.warn(`[SegmentWorker][${requestId}] JSON parsing failed. Storing raw text. Error: ${parsingError.message}`);
        responseToStore = {
            error: `JSON parsing failed: ${parsingError.message}`,
            raw_text: result.text
        };
    }
    
    const { data: newCount, error: appendError } = await supabase.rpc('append_result_and_get_count', {
        p_job_id: aggregation_job_id,
        p_new_element: responseToStore
    });

    if (appendError) {
        console.error(`[SegmentWorker][${requestId}] Failed to append result to aggregation job:`, appendError);
        throw appendError;
    }

    console.log(`[SegmentWorker][${requestId}] Successfully appended result. New count: ${newCount}.`);

    if (newCount >= NUM_WORKERS) {
        console.log(`[SegmentWorker][${requestId}] This is the final worker. Triggering compositor...`);
        await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'compositing' }).eq('id', aggregation_job_id);
        supabase.functions.invoke('MIRA-AGENT-compositor-segmentation', {
            body: { job_id: aggregation_job_id }
        }).catch(console.error);
    } else {
        console.log(`[SegmentWorker][${requestId}] Not the final worker. Current count: ${newCount}/${NUM_WORKERS}.`);
    }
    
    return new Response(JSON.stringify(responseToStore), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[SegmentWorker][${requestId}] Unhandled Error:`, error);
    // We don't need to append an error here, as the RPC call would have failed.
    // The orchestrator will eventually time out and mark the main job as failed if necessary.
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});