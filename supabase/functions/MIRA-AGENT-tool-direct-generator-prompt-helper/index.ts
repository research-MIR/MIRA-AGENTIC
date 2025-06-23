import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const BUCKET_NAME = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
];

const systemPrompt = `You are a master prompt crafter. Your task is to combine multiple inputs into a single, coherent, and detailed text-to-image prompt. The final prompt MUST be in English.

### Your Inputs:
You will receive a user request containing:
1.  **Base Prompt:** The user's original text.
2.  **Garment Images (Optional, Multiple):** A list of images labeled "GARMENT REFERENCE 1", "GARMENT REFERENCE 2", etc.
3.  **Style Image (Optional):** An image labeled "STYLE REFERENCE".

### Your Internal Thought Process (Do not include this in the output):
1.  **Analyze the Garment Images:** If multiple garment images are provided, analyze each one and describe the complete outfit they form.
2.  **Analyze the Style Image:** If present, identify its key stylistic elements: photography style, lighting, color palette, and subject pose.
3.  **Synthesize:** Combine your analysis with the user's base prompt.
    -   Intelligently insert the full outfit description into the base prompt.
    -   Incorporate the stylistic elements from the style analysis into the final prompt.

### **IMPORTANT: Handling Missing Inputs**
- **If NO images are provided:** Your task is to enrich and expand the user's base prompt. Add descriptive details to make it more vivid and suitable for a photorealistic generation, but do not invent new core concepts.
- **If ONLY ONE type of image is provided (e.g., only garment(s) or only style):** Perform your analysis on the provided image(s) and integrate the results into the base prompt.

### Your Output:
Your entire response MUST be a single, valid JSON object with ONE key, "final_prompt".

**Example Output:**
\`\`\`json
{
  "final_prompt": "A photorealistic, cinematic shot of a woman wearing a white t-shirt with red and green stripes and blue jeans, standing with her hands on her hips. The lighting is soft and diffused, with warm, earthy tones."
}
\`\`\`
`;

async function downloadImageAsPart(imageUrl: string, label: string): Promise<Part[]> {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Supabase URL or Service Role Key are not set in environment variables.");
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(imageUrl);
    const filePath = url.pathname.split(`/${BUCKET_NAME}/`)[1];
    if (!filePath) throw new Error(`Could not parse file path from URL: ${imageUrl}`);

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(BUCKET_NAME).download(filePath);
    if (downloadError) throw new Error(`Supabase download failed: ${downloadError.message}`);

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
    if (match && match[1]) {
        return JSON.parse(match[1]);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { user_prompt, garment_image_urls, style_image_url } = await req.json();
    if (!user_prompt) throw new Error("user_prompt is required.");

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const parts: Part[] = [{ text: `**Base Prompt:**\n${user_prompt}` }];

    if (garment_image_urls && Array.isArray(garment_image_urls)) {
        console.log(`Downloading ${garment_image_urls.length} garment image(s)...`);
        const garmentPromises = garment_image_urls.map((url, index) => 
            downloadImageAsPart(url, `GARMENT REFERENCE ${index + 1}`)
        );
        const garmentPartsArrays = await Promise.all(garmentPromises);
        parts.push(...garmentPartsArrays.flat());
    }

    if (style_image_url) {
        console.log("Downloading style image...");
        const styleParts = await downloadImageAsPart(style_image_url, "STYLE REFERENCE");
        parts.push(...styleParts);
    }

    console.log("Synthesizing final prompt with all inputs...");
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: "application/json" },
        safetySettings,
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const finalPrompt = responseJson.final_prompt;

    if (!finalPrompt) {
        throw new Error("AI Helper did not return a final prompt in the expected format.");
    }

    console.log("Final synthesized prompt:", finalPrompt);

    return new Response(JSON.stringify({ final_prompt: finalPrompt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[PromptHelper] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});