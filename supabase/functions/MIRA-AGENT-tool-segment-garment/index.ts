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

async function downloadImageAsPart(supabase: SupabaseClient, imageUrl: string, label: string): Promise<Part[]> {
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split(`/${BUCKET_NAME}/`);
    if (pathParts.length < 2) {
        throw new Error(`Could not parse file path from URL: ${imageUrl}`);
    }
    const filePath = pathParts[1];

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(BUCKET_NAME).download(filePath);
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
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        console.error("Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { person_image_url, garment_image_url, user_prompt } = await req.json();
    if (!person_image_url || !garment_image_url) {
      throw new Error("person_image_url and garment_image_url are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    console.log("[SegmentGarment] Downloading images...");
    const personParts = await downloadImageAsPart(supabase, person_image_url, "PERSON IMAGE");
    const garmentParts = await downloadImageAsPart(supabase, garment_image_url, "GARMENT IMAGE");

    const userParts: Part[] = [...personParts, ...garmentParts];
    if (user_prompt) {
        userParts.push({ text: `--- USER PROMPT ---` });
        userParts.push({ text: user_prompt });
    }

    console.log("[SegmentGarment] Calling Gemini for segmentation...");
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const segmentationResult = responseJson.segmentation_result;

    if (!segmentationResult || !segmentationResult.mask) {
        throw new Error("AI did not return a valid segmentation result.");
    }

    console.log(`[SegmentGarment] Segmentation successful. Label: "${segmentationResult.label}"`);

    return new Response(JSON.stringify({ segmentation_result: segmentationResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[SegmentGarment] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});