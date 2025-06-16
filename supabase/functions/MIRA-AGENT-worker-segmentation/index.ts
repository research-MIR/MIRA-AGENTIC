import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const BUCKET_NAME = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a specialist AI segmentation expert for virtual try-on. Your task is to analyze a person image and a garment image to identify the precise area on the person that should be replaced.

### Your Inputs:
1.  **PERSON IMAGE:** The image of the person.
2.  **GARMENT IMAGE:** The image of the clothing item.
3.  **USER PROMPT (Optional):** Specific instructions from the user, like "just the t-shirt". This prompt takes precedence.

### Your Task:
-   Analyze the images and the prompt.
-   Determine the exact region on the PERSON IMAGE that corresponds to the GARMENT IMAGE.
-   Generate a single, unified segmentation mask for this entire region. For example, if it's a t-shirt, the mask should cover the torso and arms where the shirt would be.

### Output Format:
Your entire response MUST be a single, valid JSON object containing one key: "segmentation_result".
The value of this key must be an object with the following structure:
-   \`label\`: A brief description of the segmented area (e.g., "t-shirt and torso area").
-   \`box_2d\`: The bounding box of the mask as an array of four numbers: [x_min, y_min, x_max, y_max].
-   \`mask\`: The Base64 encoded Run-Length Encoded (RLE) mask data.

**Example Output:**
\`\`\`json
{
  "segmentation_result": {
    "label": "t-shirt area",
    "box_2d": [150, 200, 450, 500],
    "mask": "..."
  }
}
\`\`\`
`;

async function downloadImageAsPart(supabase: SupabaseClient, imageUrl: string, label: string, requestId: string): Promise<Part[]> {
    console.log(`[SegmentWorker][${requestId}] Downloading image for '${label}' from URL: ${imageUrl}`);
    const url = new URL(imageUrl);
    const rawPath = url.pathname.split(`/${BUCKET_NAME}/`)[1];
    if (!rawPath) {
        throw new Error(`Could not parse file path from URL: ${imageUrl}`);
    }
    const filePath = decodeURIComponent(rawPath);
    console.log(`[SegmentWorker][${requestId}] Parsed and decoded storage path: ${filePath}`);

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(BUCKET_NAME).download(filePath);
    if (downloadError) throw new Error(`Supabase download failed for ${filePath}: ${downloadError.message}`);

    const mimeType = fileBlob.type;
    const buffer = await fileBlob.arrayBuffer();
    const base64 = encodeBase64(buffer);
    console.log(`[SegmentWorker][${requestId}] Successfully downloaded and encoded '${label}'. Size: ${buffer.byteLength} bytes.`);

    return [
        { text: `--- ${label} ---` },
        { inlineData: { mimeType, data: base64 } }
    ];
}

function extractJson(text: string, requestId: string): any {
    console.log(`[SegmentWorker][${requestId}] Attempting to extract JSON from model response.`);
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        console.log(`[SegmentWorker][${requestId}] Found JSON in markdown block.`);
        return JSON.parse(match[1]);
    }
    try {
        console.log(`[SegmentWorker][${requestId}] Attempting to parse raw text as JSON.`);
        return JSON.parse(text);
    } catch (e) {
        console.error(`[SegmentWorker][${requestId}] Failed to parse JSON from model response. Raw text:`, text);
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

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    await supabase.from('mira-agent-segmentation-jobs').update({ status: 'processing' }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-segmentation-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;

    const { person_image_url, garment_image_url, user_prompt } = job;

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const personParts = await downloadImageAsPart(supabase, person_image_url, "PERSON IMAGE", job_id);
    const garmentParts = await downloadImageAsPart(supabase, garment_image_url, "GARMENT IMAGE", job_id);

    const userParts: Part[] = [...personParts, ...garmentParts];
    if (user_prompt) {
        userParts.push({ text: `--- USER PROMPT ---` });
        userParts.push({ text: user_prompt });
    }

    console.log(`[SegmentWorker][${job_id}] Calling Gemini for segmentation with model ${MODEL_NAME}.`);
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    if (!result.text) {
        console.error(`[SegmentWorker][${job_id}] Gemini response was empty. Full response object:`, JSON.stringify(result, null, 2));
        const blockReason = result.response?.promptFeedback?.blockReason;
        const blockMessage = result.response?.promptFeedback?.blockReasonMessage;
        let errorMessage = "The AI model failed to return a valid response.";
        if (blockReason) errorMessage += ` Reason: ${blockReason}.`;
        if (blockMessage) errorMessage += ` Details: ${blockMessage}`;
        throw new Error(errorMessage);
    }
    
    console.log(`[SegmentWorker][${job_id}] Raw response from Gemini:`, result.text);

    const responseJson = extractJson(result.text, job_id);
    const segmentationResult = responseJson.segmentation_result;

    if (!segmentationResult || !segmentationResult.mask) {
      throw new Error("AI did not return a valid segmentation result in the JSON payload.");
    }

    await supabase.from('mira-agent-segmentation-jobs').update({
      status: 'complete',
      result: segmentationResult
    }).eq('id', job_id);

    console.log(`[SegmentWorker][${job_id}] Job complete. Result stored in database.`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[SegmentWorker][${job_id}] Error:`, error);
    await supabase.from('mira-agent-segmentation-jobs').update({
      status: 'failed',
      error_message: error.message
    }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});