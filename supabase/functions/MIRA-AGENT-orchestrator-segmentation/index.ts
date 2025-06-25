// Redeploy trigger: 2024-07-12T10:00:00.000Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const NUM_WORKERS = 5; // A safer number to avoid timeouts even during gathering

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
        console.error("[Orchestrator] Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { image_base64, mime_type, reference_image_base64, reference_mime_type, user_id, image_dimensions } = await req.json();
  const requestId = `segment-orchestrator-${Date.now()}`;
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  let aggregationJobId: string | null = null;

  try {
    if (!user_id || !image_base64 || !mime_type || !image_dimensions) {
      throw new Error("Missing required parameters for new job.");
    }

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .insert({ 
          user_id, 
          status: 'aggregating',
          source_image_dimensions: image_dimensions, 
          results: [] 
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    aggregationJobId = newJob.id;
    console.log(`[Orchestrator][${requestId}] Aggregation job ${aggregationJobId} created.`);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const userParts: Part[] = [
        { text: "SOURCE IMAGE:" }, { inlineData: { mimeType: mime_type, data: image_base64 } },
    ];
    if (reference_image_base64 && reference_mime_type) {
        userParts.push({ text: "REFERENCE IMAGE:" }, { inlineData: { mimeType: reference_mime_type, data: reference_image_base64 } });
    }
    userParts.push({ text: systemPrompt });
    const contents: Content[] = [{ role: 'user', parts: userParts }];

    const workerPromises = Array.from({ length: NUM_WORKERS }).map((_, i) => 
        ai.models.generateContent({
            model: MODEL_NAME,
            contents: contents,
            generationConfig: { responseMimeType: "application/json" },
            safetySettings,
        }).then(result => {
            if (!result.text) throw new Error(`Model worker ${i} returned an empty response.`);
            return extractJson(result.text);
        }).catch(err => ({ error: `Worker ${i} failed: ${err.message}` }))
    );

    const allResults = await Promise.all(workerPromises);
    
    await supabase.from('mira-agent-mask-aggregation-jobs')
      .update({ results: allResults, status: 'compositing' })
      .eq('id', aggregationJobId);
    console.log(`[Orchestrator][${requestId}] All workers finished. Results saved to DB. Handing off to compositor.`);

    // Asynchronously invoke the compositor and don't wait for its response
    supabase.functions.invoke('MIRA-AGENT-compositor-segmentation', {
        body: { job_id: aggregationJobId }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, message: `Segmentation job handed off for final composition.`, aggregationJobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Orchestrator][${requestId}] Error:`, error);
    if (aggregationJobId) {
        await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', aggregationJobId);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});