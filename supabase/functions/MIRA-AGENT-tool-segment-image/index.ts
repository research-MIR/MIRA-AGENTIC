import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const MAX_RETRIES = 3;
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
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type, aggregation_job_id } = await req.json();
  if (!image_base64 || !mime_type || !prompt || !aggregation_job_id) {
    throw new Error("image_base64, mime_type, prompt, and aggregation_job_id are required.");
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
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

    let result;
    let responseJson;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: contents,
                generationConfig: { responseMimeType: "application/json" },
                safetySettings,
            });
            responseJson = extractJson(result.text);
            lastError = null;
            break;
        } catch (error) {
            lastError = error;
            if (attempt < MAX_RETRIES) await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
    }

    if (lastError) throw lastError;

    const maskData = responseJson.masks || responseJson;
    if (Array.isArray(maskData) && maskData.length > 0) {
        const { error: rpcError } = await supabase.rpc('append_to_jsonb_array', {
            table_name: 'mira-agent-mask-aggregation-jobs',
            row_id: aggregation_job_id,
            column_name: 'results',
            new_element: maskData
        });
        if (rpcError) throw new Error(`Failed to append result to aggregation job: ${rpcError.message}`);
        
        // Asynchronously trigger the aggregator
        supabase.functions.invoke('MIRA-AGENT-aggregator-mask', { body: { job_id: aggregation_job_id } }).catch(console.error);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    await supabase.from('mira-agent-mask-aggregation-jobs').update({
        status: 'failed',
        error_message: `A segmentation sub-task failed: ${error.message}`
    }).eq('id', aggregation_job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});