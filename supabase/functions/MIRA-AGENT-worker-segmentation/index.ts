import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

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
    if (match && match[1]) {
        return JSON.parse(match[1]);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("[SegmentWorker] Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

async function appendResultToJob(supabase: any, jobId: string, result: any) {
    const { data: newCount, error } = await supabase.rpc('append_result_and_get_count', {
        p_job_id: jobId,
        p_new_element: result
    });
    if (error) {
        console.error(`[SegmentWorker] Failed to append result to aggregation job ${jobId}:`, error);
        throw error;
    }
    console.log(`[SegmentWorker] Successfully appended result. New count for job ${jobId} is: ${newCount}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // --- ARTIFICIAL DELAY TO PREVENT RACE CONDITIONS ---
  const delay = Math.random() * 1000; // Random delay up to 1 second
  await new Promise(resolve => setTimeout(resolve, delay));
  // ----------------------------------------------------

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

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[SegmentWorker][${requestId}] Calling Gemini API, attempt ${attempt}...`);
            const result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: contents,
                generationConfig: { responseMimeType: "application/json" },
                safetySettings,
            });
            
            console.log(`[SegmentWorker][${requestId}] Raw response from Gemini on attempt ${attempt}:`, result.text);

            let responseToStore;
            try {
                const responseJson = extractJson(result.text);
                if (!responseJson || !Array.isArray(responseJson) || responseJson.length === 0 || !responseJson[0].mask || typeof responseJson[0].mask !== 'string' || !responseJson[0].box_2d) {
                    throw new Error("Model returned a JSON with an invalid or missing mask/box_2d structure.");
                }

                const normalizedResponse = responseJson.map(item => {
                    if (item.mask && typeof item.mask === 'string' && !item.mask.startsWith('data:image/png;base64,')) {
                        item.mask = `data:image/png;base64,${item.mask}`;
                    }
                    if (item.box_2d && Array.isArray(item.box_2d[0])) {
                        item.box_2d = [item.box_2d[0][0], item.box_2d[0][1], item.box_2d[1][0], item.box_2d[1][1]];
                    }
                    return item;
                });

                responseToStore = normalizedResponse;
                console.log(`[SegmentWorker][${requestId}] Successfully parsed and normalized JSON. Found ${responseToStore.length} masks.`);
            } catch (parsingError) {
                console.warn(`[SegmentWorker][${requestId}] JSON parsing failed. Storing raw text. Error: ${parsingError.message}`);
                responseToStore = {
                    error: `JSON parsing failed: ${parsingError.message}`,
                    raw_text: result.text
                };
            }
            
            await appendResultToJob(supabase, aggregation_job_id, responseToStore);
            
            return new Response(JSON.stringify(responseToStore), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
              status: 200,
            });
        } catch (error) {
            lastError = error;
            console.warn(`[SegmentWorker][${requestId}] Attempt ${attempt} failed:`, error.message);
            if (attempt < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            }
        }
    }

    throw lastError || new Error("Worker failed after all retries without a specific error.");

  } catch (error) {
    console.error(`[SegmentWorker][${requestId}] Unhandled Error:`, error);
    await appendResultToJob(supabase, aggregation_job_id, { error: `Worker failed: ${error.message}` });
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});