import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MODEL_NAME = "gemini-2.5-flash-lite-preview-06-17";
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

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

const garmentSystemPrompt = `You are an expert fashion stylist and photo analyst. Your task is to combine multiple inputs into a single, coherent, and detailed text-to-image prompt. The final prompt MUST be in English.

### Your Inputs:
You will be given:
1.  **PERSON IMAGE:** This image contains the model, their pose, the background scene, and the overall lighting and mood.
2.  **GARMENT IMAGE:** This image contains a piece of clothing.
3.  **PROMPT APPENDIX (Optional, HIGH PRIORITY):** A specific, non-negotiable instruction from the user.
4.  **IS_HELPER_ENABLED (Boolean):** A flag indicating your mode of operation.

### Your Internal Thought Process (Do not include this in the output):

#### **IF 'IS_HELPER_ENABLED' IS TRUE:**
1.  **Analyze the PERSON IMAGE:** Deconstruct the scene. Describe the model's pose, the lighting style (e.g., "soft studio lighting," "harsh outdoor sunlight"), the background details, and the overall mood or aesthetic.
2.  **Analyze the GARMENT IMAGE:** Describe the garment with extreme detail. **IMPORTANT: You MUST focus exclusively on the garment or accessory itself. IGNORE any person, pose, or background present in the GARMENT IMAGE.** Mention its type (e.g., "denim jacket," "silk blouse"), color, fabric texture, fit, and any notable details like buttons, zippers, patterns, or stitching.
3.  **Synthesize the Final Prompt:** Create a new, single prompt that describes the person from the PERSON IMAGE as if they are now wearing the clothing from the GARMENT IMAGE.
    -   **If a PROMPT APPENDIX is provided:** You MUST seamlessly integrate this instruction into the main body of your description. It is a core creative constraint.
    -   **If NO PROMPT APPENDIX is provided:** Your final prompt should be a rich, detailed description based solely on your analysis of the two images.

#### **IF 'IS_HELPER_ENABLED' IS FALSE:**
1.  **IGNORE THE IMAGES COMPLETELY.**
2.  Your ONLY task is to process the **PROMPT APPENDIX**.
3.  If the appendix contains text, use that text as the final prompt.
4.  **If the appendix is empty or missing, you MUST return the following generic fallback prompt: "a photorealistic image of the garment on the person".**

### Your Output:
Your entire response MUST be a single, valid JSON object with ONE key, "final_prompt".

**Example Output (with appendix "wearing light blue jeans" and helper ON):**
\`\`\`json
{
  "final_prompt": "A photorealistic, cinematic shot of a woman standing with her hands on her hips in a dimly lit urban alleyway. She is wearing a vintage, slightly oversized, faded blue denim jacket with brass buttons, paired with light blue jeans. The lighting is dramatic, with a single light source from the side creating long shadows."
}
\`\`\`
**Example Output (with appendix "a red t-shirt" and helper OFF):**
\`\`\`json
{
  "final_prompt": "a red t-shirt"
}
\`\`\`
**Example Output (with NO appendix and helper OFF):**
\`\`\`json
{
  "final_prompt": "a photorealistic image of the garment on the person"
}
\`\`\`
`;

const generalSystemPrompt = `You are an expert image analyst and prompt crafter. Your task is to combine two images and an optional user instruction into a single, coherent, and detailed text-to-image prompt for an inpainting task. The final prompt MUST be in English.

### Your Inputs:
You will be given:
1.  **SOURCE IMAGE:** This is the base image that will be modified. It contains the overall scene, lighting, and context.
2.  **REFERENCE IMAGE:** This image contains the object, texture, or concept that needs to be integrated into the SOURCE IMAGE.
3.  **PROMPT APPENDIX (Optional, HIGH PRIORITY):** A specific, non-negotiable instruction from the user.

### Your Internal Thought Process (Do not include this in the output):
1.  **Analyze the SOURCE IMAGE:** Deconstruct the scene. Describe the lighting style (e.g., "soft studio lighting," "harsh outdoor sunlight"), the background details, and the overall mood or aesthetic.
2.  **Analyze the REFERENCE IMAGE:** Describe the object or concept in the reference image with extreme detail. Mention its key characteristics, texture, color, and style.
3.  **Synthesize with Appendix:** Create a new, single prompt that describes how the object/concept from the REFERENCE IMAGE should be realistically integrated into the SOURCE IMAGE. The goal is a seamless blend. **You MUST incorporate the user's PROMPT APPENDIX instruction into the main body of your description.** Do not just append it.

### Your Output:
Your entire response MUST be a single, valid JSON object with ONE key, "final_prompt".

**Example Output (with appendix "make it look like a tattoo on the arm"):**
\`\`\`json
{
  "final_prompt": "A photorealistic, detailed tattoo of a roaring lion's head on a person's bicep. The tattoo ink is dark black, with sharp lines and soft shading that follows the contours of the muscle. The lighting is soft and natural, casting a gentle highlight on the skin and the tattoo."
}
\`\`\`
`;

async function downloadImageAsPart(publicUrl: string, label: string): Promise<Part[]> {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Supabase URL or Service Role Key are not set in environment variables.");
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(publicUrl);
    const filePath = url.pathname.split(`/${UPLOAD_BUCKET}/`)[1];
    if (!filePath) throw new Error(`Could not parse file path from URL: ${publicUrl}`);

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath);
    if (downloadError) throw new Error(`Supabase download failed for ${label}: ${downloadError.message}`);

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
    const { 
        person_image_url, garment_image_url,
        person_image_base64, person_image_mime_type,
        garment_image_base64, garment_image_mime_type,
        prompt_appendix,
        is_garment_mode,
        is_helper_enabled
    } = await req.json();

    const useHelper = is_helper_enabled !== false; // Default to true
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const finalParts: Part[] = [];
    const systemPrompt = (is_garment_mode !== false) ? garmentSystemPrompt : generalSystemPrompt;
    const personLabel = (is_garment_mode !== false) ? "PERSON IMAGE" : "SOURCE IMAGE";
    const garmentLabel = (is_garment_mode !== false) ? "GARMENT IMAGE" : "REFERENCE IMAGE";

    console.log(`[VTO-PromptHelper] Mode: ${is_garment_mode ? 'Garment' : 'General'}. Helper Enabled: ${useHelper}`);

    if (useHelper) {
        console.log("[VTO-PromptHelper] AI Helper is ON. Analyzing images to synthesize final prompt.");
        let personParts: Part[], garmentParts: Part[];
        
        if (person_image_base64 && garment_image_base64) {
            console.log("[VTO-PromptHelper] Using provided base64 data.");
            personParts = [
                { text: `--- ${personLabel} ---` },
                { inlineData: { mimeType: person_image_mime_type || 'image/png', data: person_image_base64 } }
            ];
            garmentParts = [
                { text: `--- ${garmentLabel} ---` },
                { inlineData: { mimeType: garment_image_mime_type || 'image/png', data: garment_image_base64 } }
            ];
        } else if (person_image_url && garment_image_url) {
            console.log("[VTO-PromptHelper] Using provided URLs. Downloading images...");
            [personParts, garmentParts] = await Promise.all([
                downloadImageAsPart(person_image_url, personLabel),
                downloadImageAsPart(garment_image_url, garmentLabel)
            ]);
        } else {
            throw new Error("When AI Helper is enabled, either image URLs or base64 data for both images are required.");
        }
        
        finalParts.push(...personParts, ...garmentParts);
    } else {
        console.log("[VTO-PromptHelper] AI Helper is OFF. Using appendix only.");
    }

    if (prompt_appendix && typeof prompt_appendix === 'string' && prompt_appendix.trim() !== "") {
        finalParts.push({ text: `--- PROMPT APPENDIX (HIGH PRIORITY) ---\n${prompt_appendix.trim()}` });
    }
    finalParts.push({ text: `--- METADATA ---\nIS_HELPER_ENABLED: ${useHelper}` });

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: finalParts }],
        generationConfig: { responseMimeType: "application/json" },
        safetySettings,
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const finalPrompt = responseJson.final_prompt;

    if (!finalPrompt) {
        throw new Error("AI Helper did not return a final prompt in the expected format.");
    }

    return new Response(JSON.stringify({ final_prompt: finalPrompt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-PromptHelper] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});