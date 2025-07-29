import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-lite-preview-06-17";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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

const systemPrompt = `You are a "Quality Assurance AI" for a photorealistic model generation pipeline. You will be given a user's creative brief, the final detailed prompt that was sent to the image generator, and four candidate images. Your sole task is to evaluate them and choose the single best one that matches all requirements, and identify the model's gender.

### Your Inputs:
- **User's Brief:** The original, high-level description from the user.
- **Final Generation Prompt:** The exact, detailed prompt used to create the images. This is your primary source of truth for technical and stylistic evaluation.
- **Candidate Images:** Four images labeled "Image 0" through "Image 3".

### Evaluation Criteria (in order of importance):
1.  **Pose & Framing Compliance (Highest Priority):** The image MUST be a full-body shot, and the model MUST be in a neutral, frontal, standing A-pose with arms relaxed at their sides and a neutral facial expression. You must explicitly check if the prompt's "FULL BODY SHOOT" rule was followed. Reject any image that is a close-up, medium shot, or has a dynamic/expressive pose.
2.  **Prompt Coherence:** Does the model in the image accurately reflect the **Final Generation Prompt**? This is more important than the original user brief. Check for specific details mentioned in the final prompt (e.g., lighting, background, specific clothing).
3.  **Anatomical Correctness:** The model must have realistic human anatomy. Check for common AI errors like incorrect hands, distorted limbs, or unnatural facial features. Reject any image with clear anatomical flaws.
4.  **Photorealism:** The image should look like a real photograph. Assess the skin texture, lighting, and overall quality.
5.  **Aesthetic Appeal (Tie-breaker only):** If multiple images perfectly satisfy all the above criteria, use general aesthetic appeal as the final deciding factor.

### Gender Identification:
After selecting the best image, you MUST identify the gender of the model. The value must be one of two strings: "male" or "female".

### Your Output:
Your entire response MUST be a single, valid JSON object with TWO keys: "best_image_index" and "gender".

**Example Output:**
\`\`\`json
{
  "best_image_index": 2,
  "gender": "female"
}
\`\`\`
`;

async function downloadImageAsPart(supabase: SupabaseClient, publicUrl: string, label: string): Promise<Part[]> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download ${label}: ${error.message}`);
    const buffer = await data.arrayBuffer();
    const base64 = encodeBase64(buffer);
    return [{ inlineData: { mimeType: data.type, data: base64 } }];
}

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { image_urls, model_description, set_description, final_generation_prompt } = await req.json();
    if (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0) {
      throw new Error("image_urls array is required.");
    }
    if (!model_description) {
      throw new Error("model_description is required for coherence check.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    
    const userBriefText = `--- USER'S CREATIVE BRIEF ---\nModel Description: "${model_description}"\nSet Description: "${set_description || 'a minimal studio with a neutral background'}"\n\n--- FINAL GENERATION PROMPT (PRIMARY TRUTH) ---\n${final_generation_prompt || 'Not provided.'}\n--- END BRIEF ---`;
    const parts: Part[] = [{ text: userBriefText }];

    const imagePartsPromises = image_urls.map((url, index) => downloadImageAsPart(supabase, url, `Image ${index}`));
    const imagePartsArrays = await Promise.all(imagePartsPromises);
    parts.push(...imagePartsArrays.flat());

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const bestIndex = responseJson.best_image_index;
    const gender = responseJson.gender;

    if (typeof bestIndex !== 'number' || bestIndex < 0 || bestIndex >= image_urls.length) {
        throw new Error("AI did not return a valid index for the best image.");
    }
    if (gender !== 'male' && gender !== 'female') {
        throw new Error("AI did not return a valid gender ('male' or 'female').");
    }

    return new Response(JSON.stringify({ best_image_index: bestIndex, gender: gender }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[QualityAssuranceTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});