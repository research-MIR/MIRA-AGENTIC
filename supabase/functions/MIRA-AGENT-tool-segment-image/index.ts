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
    const { error } = await supabase.rpc('append_to_jsonb_array', {
        table_name: 'mira-agent-mask-aggregation-jobs',
        row_id: jobId,
        column_name: 'results',
        new_element: result
    });
    if (error) {
        console.error(`[SegmentWorker] Failed to append result to aggregation job ${jobId}:`, error);
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type, aggregation_job_id } = await req.json();
  const requestId = `segment-worker-${aggregation_job_id}-${Math.random().toString(36).substring(2, 8)}`;
  console.log(`[SegmentWorker][${requestId}] Invoked for aggregation job ${aggregation_job_id}.`);
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    if (!image_base64 || !mime_type || !prompt || !aggregation_job_id) {
      throw new Error("image_base64, mime_type, prompt, and aggregation_job_id are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const userParts: Part[] = [
        { text: "SOURCE IMAGE:" },
        { inlineData: { mimeType: mime_type, data: image_base64 } },
    ];

    if (reference_image_base64 && reference_mime_type) {
        userParts.push(
            { text: "REFERENCE IMAGE:" },
            { inlineData: { mimeType: reference_mime_type, data: reference_image_base64 } }
        );
    }

    userParts.push({ text: prompt });
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
                if (!responseJson || !Array.isArray(responseJson.masks) || responseJson.masks.length === 0) {
                    throw new Error("Model returned a valid JSON but it did not contain a 'masks' array.");
                }
                responseToStore = responseJson;
                console.log(`[SegmentWorker][${requestId}] Successfully parsed JSON. Found ${responseJson.masks.length} masks.`);
            } catch (parsingError) {
                console.warn(`[SegmentWorker][${requestId}] JSON parsing failed. Storing raw text. Error: ${parsingError.message}`);
                responseToStore = {
                    error: `JSON parsing failed: ${parsingError.message}`,
                    raw_text: result.text
                };
            }
            
            await appendResultToJob(supabase, aggregation_job_id, responseToStore);
            console.log(`[SegmentWorker][${requestId}] Successfully appended result to aggregation job.`);
            
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