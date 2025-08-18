import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE
  }
];

const systemPrompt = `You are a "Quality Assurance AI" for a photorealistic model generation pipeline. You will be given a user's creative brief, the final detailed prompt that was sent to the image generator, and four candidate images. Your task is to act as a gatekeeper: first, validate if any images meet the core requirements, and then select the best one.

### Primary Directive: Full Body Shot Validation (Zero Tolerance Policy)
Your first and most important task is to validate if any of the candidate images are a true full body shot. An image is an **AUTOMATIC FAILURE** and is considered invalid if it meets any of these criteria:
- It is a close-up, medium shot, or portrait.
- The model's feet are not **fully visible**.
- Any part of the model's body (including the top of their head or hair) is cropped by the frame.
This is a zero-tolerance rule.

### Decision Logic & Evaluation Criteria:
1.  **Scan all images against the Primary Directive.**
2.  **If one or more images are valid:** Your action is to **"select"**. From *only the valid candidates*, choose the single best one based on the following criteria in order of importance:
    a.  **Anatomical Correctness:** The model must have realistic human anatomy. Reject any image with clear flaws (e.g., incorrect hands, distorted limbs).
    b.  **Prompt Coherence:** The model must accurately reflect the **Final Generation Prompt**.
    c.  **Photorealism & Aesthetic Appeal:** The image should be high quality and visually appealing.
3.  **If ZERO images are valid:** Your action is to **"retry"**. The entire batch fails the primary directive.

### Gender Identification:
If your action is "select", you MUST identify the gender of the model in the selected image. The value must be one of two strings: "male" or "female".

### Your Output:
Your entire response MUST be a single, valid JSON object with the following keys: "action", "best_image_index", "gender", and "reasoning".

**Example Output (Success):**
\`\`\`json
{
  "action": "select",
  "best_image_index": 2,
  "gender": "female",
  "reasoning": "Images 0 and 1 were invalid medium shots. Image 2 was selected from the valid candidates as it has the highest photorealism and best anatomical correctness."
}
\`\`\`

**Example Output (Failure):**
\`\`\`json
{
  "action": "retry",
  "best_image_index": null,
  "gender": null,
  "reasoning": "All four candidates failed the 'Full body shot' requirement. The generations were primarily medium shots, violating the core prompt."
}
\`\`\`
`;

async function downloadImageAsPart(supabase: any, publicUrl: string, label: string) {
  const url = new URL(publicUrl);
  const pathSegments = url.pathname.split('/');
  const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
  const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
  const { data, error } = await supabase.storage.from(bucketName).download(filePath);
  if (error) throw new Error(`Failed to download ${label}: ${error.message}`);
  const buffer = await data.arrayBuffer();
  const base64 = encodeBase64(buffer);
  return [{
    inlineData: {
      mimeType: data.type,
      data: base64
    }
  }];
}

function extractJson(text: string) {
  if (!text) {
    throw new Error("The model returned an empty response.");
  }
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (e) {
      console.error("[QualityAssuranceTool] Failed to parse extracted JSON block:", e);
      // Fall through to try parsing the whole string
    }
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`[QualityAssuranceTool] Failed to parse raw text as JSON. Text was: "${text}"`);
    throw new Error("The model returned a response that could not be parsed as JSON.");
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { image_urls, model_description, set_description, final_generation_prompt } = await req.json();
    if (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0) {
      throw new Error("image_urls array is required.");
    }
    if (!model_description) {
      throw new Error("model_description is required for coherence check.");
    }
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY!
    });
    const userBriefText = `--- USER'S CREATIVE BRIEF ---\nModel Description: "${model_description}"\nSet Description: "${set_description || 'a minimal studio with a neutral background'}"\n\n--- FINAL GENERATION PROMPT (PRIMARY TRUTH) ---\n${final_generation_prompt || 'Not provided.'}\n--- END BRIEF ---`;
    const parts = [{
      text: userBriefText
    }];
    const imagePartsPromises = image_urls.map((url, index) => downloadImageAsPart(supabase, url, `Image ${index}`));
    const imagePartsArrays = await Promise.all(imagePartsPromises);
    parts.push(...imagePartsArrays.flat());
    let result = null;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[QualityAssuranceTool] Calling Gemini API, attempt ${attempt}/${MAX_RETRIES}...`);
        result = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [{
            role: 'user',
            parts: parts
          }],
          generationConfig: {
            responseMimeType: "application/json"
          },
          safetySettings,
          config: {
            systemInstruction: {
              role: "system",
              parts: [{
                text: systemPrompt
              }]
            }
          }
        });
        if (result?.text) {
          lastError = null; // Clear error on success
          break; // Exit loop on success
        }
        console.warn(`[QualityAssuranceTool] Attempt ${attempt} resulted in an empty or blocked response. Full response:`, JSON.stringify(result, null, 2));
        lastError = new Error("AI model returned an empty or blocked response.");
      } catch (error) {
        lastError = error;
        console.warn(`[QualityAssuranceTool] Attempt ${attempt} failed:`, error.message);
      }
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * attempt; // Exponential backoff
        console.log(`[QualityAssuranceTool] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    if (lastError) {
      console.error(`[QualityAssuranceTool] All retries failed. Last error:`, lastError.message);
      throw lastError;
    }
    if (!result || !result.text) {
      console.error("[QualityAssuranceTool] AI model failed to return a valid text response after all retries. Full response:", JSON.stringify(result, null, 2));
      throw new Error("AI model failed to respond with valid text after all retries.");
    }

    const responseJson = extractJson(result.text);
    const { action, best_image_index, gender, reasoning } = responseJson;

    if (!action || (action !== 'select' && action !== 'retry')) {
        throw new Error("AI response is missing a valid 'action' ('select' or 'retry').");
    }

    if (action === 'select') {
        if (typeof best_image_index !== 'number' || best_image_index < 0 || best_image_index >= image_urls.length) {
            throw new Error("AI action was 'select' but it did not return a valid 'best_image_index'.");
        }
        if (gender !== 'male' && gender !== 'female') {
            throw new Error("AI action was 'select' but it did not return a valid 'gender' ('male' or 'female').");
        }
    }

    // Return the full analysis object for the poller to handle
    return new Response(JSON.stringify(responseJson), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error("[QualityAssuranceTool] Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});