import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

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

const systemPrompt = `You are a "VTO Quality Assurance AI". You will be given a reference garment image, an original person image, and a set of generated "try-on" images. Your sole task is to evaluate the generated images and decide on an action: 'select' the best one, or 'retry' if none are acceptable.

### Your Inputs:
- **is_escalation_check (boolean):** A flag indicating this is the last chance to use the current generation engine. If you choose 'retry', the job will be escalated to a more powerful, slower engine. Be less strict.
- **is_absolute_final_attempt (boolean):** A flag indicating this is the ABSOLUTE LAST CHANCE. The next step after this is failure.
- A series of images: REFERENCE GARMENT, ORIGINAL PERSON, and one or more GENERATED IMAGES.

### Your Internal Thought Process (Chain-of-Thought)
1.  **Analyze REFERENCE Garment:** Briefly describe its key features.
2.  **Analyze Each Generated Image:** Evaluate each image based on the core criteria.
3.  **Make a Decision based on the attempt flags:**
    -   **If 'is_absolute_final_attempt' is TRUE:** You are FORBIDDEN from choosing the 'retry' action. You MUST choose the 'select' action and pick the single best image from all provided generated images, no matter how flawed. Your reasoning should explain that this is the best available option after all attempts have been exhausted.
    -   **If 'is_escalation_check' is TRUE (but 'is_absolute_final_attempt' is FALSE):** This is your last chance to use the current engine. If there is at least one *acceptable* image that does NOT meet any of the 'Fundamentally Flawed' criteria, you MUST select the best one. However, if ALL available images are fundamentally flawed, you SHOULD select \`action: "retry"\`. This is not a failure; it is the correct procedure to escalate the job to a more powerful generation engine.
    -   **If both flags are FALSE:** Be highly critical. If ALL images have significant flaws, your action MUST be 'retry'.
4.  **State Your Final Choice & Justification:** Clearly state your decision and why it is the best choice based on the evaluation criteria.

### Defining 'Fundamentally Flawed'
An image is considered fundamentally flawed and MUST be rejected if it meets any of these criteria:
- **Garment Mismatch:** The generated garment is a completely different type from the reference (e.g., a shirt instead of a jacket).
- **Anatomical Distortion:** The model has severe, unrealistic anatomical errors.
- **Severe Artifacts:** The image is unusable due to overwhelming visual noise, glitches, or blending errors.

### Evaluation Criteria (in order of importance):
1.  **Garment Similarity (Highest Priority):** The garment on the model must be the most accurate reproduction of the reference garment. This is the most important factor. A failure here means the image is fundamentally flawed.
2.  **Outfit Coherence (Positive Tie-Breaker):** After confirming garment similarity, evaluate the rest of the outfit. An image that shows a complete, plausible outfit (e.g., the AI adds matching pants to a hoodie) is **STRONGLY PREFERRED** and should be selected over an otherwise equal image that leaves the model in their base underwear. **Crucially, a complete outfit is a bonus, not a requirement. Its absence is NOT a flaw and is NEVER a reason to select the 'retry' action on its own. - EVEN IF THE GARMENT IMAGE PRESENTS ONLY A LOWER BODY OR UPPER BODY IS 100% FINE TO HAVE IT IN A COMPLETE OUTFIT, IS EVEN PREFERABLE - NEVER A COMPLETED OUTFIT ON ITS OWN EVEN OF A SINGLE GARMENT, IS TO BE CONSIDERED A ERROR** A retry should only be triggered by fundamental flaws in the garment swap itself or severe image artifacts.
3.  **Pose Preservation (Tertiary Priority):** The model's pose should be as close as possible to their original pose.
4.  **Image Quality & Artifacts:** The image should be free of obvious AI artifacts or distortions.

### Your Output:
Your entire response MUST be a single, valid JSON object with the following structure.

**CRITICAL OUTPUT RULE:** Your JSON response MUST ALWAYS contain a valid "best_image_index" key with a number value (0, 1, 2, etc.). This is non-negotiable. If your action is "retry", you MUST still select the index of the image that is the "least bad" or has the most potential for a fix, even if it is unacceptable. The value for "best_image_index" can NEVER be \`null\`.

**If action is 'select':**
\`\`\`json
{
  "action": "select",
  "best_image_index": <number>,
  "reasoning": "A detailed explanation of why this image was chosen over the others."
}
\`\`\`

**If action is 'retry':**
\`\`\`json
{
  "action": "retry",
  "best_image_index": 1,
  "reasoning": "A detailed explanation of why all images were rejected. Image 1 was the closest but still had [specific flaw], so a retry is necessary."
}
\`\`\`
`;

function extractJson(text: string): any {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match && match[1]) return JSON.parse(match[1]);
  try {
    return JSON.parse(text);
  } catch (e) {
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
    const { original_person_image_base64, reference_garment_image_base64, generated_images_base64, is_escalation_check, is_absolute_final_attempt } = await req.json();
    if (!original_person_image_base64 || !reference_garment_image_base64 || !generated_images_base64 || !Array.isArray(generated_images_base64) || generated_images_base64.length === 0) {
      throw new Error("original_person_image_base64, reference_garment_image_base64, and a non-empty generated_images_base64 array are required.");
    }
    const ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY
    });
    const userPromptText = `This is the evaluation. is_escalation_check is ${is_escalation_check}. is_absolute_final_attempt is ${is_absolute_final_attempt}. Please analyze the following images and provide your decision.`;
    const parts: Part[] = [
      {
        text: userPromptText
      },
      {
        text: "--- ORIGINAL PERSON IMAGE ---"
      },
      {
        inlineData: {
          mimeType: 'image/png',
          data: original_person_image_base64
        }
      },
      {
        text: "--- REFERENCE GARMENT IMAGE ---"
      },
      {
        inlineData: {
          mimeType: 'image/png',
          data: reference_garment_image_base64
        }
      }
    ];
    generated_images_base64.forEach((base64: string, index: number) => {
      parts.push({
        text: `--- GENERATED IMAGE ${index} ---`
      });
      parts.push({
        inlineData: {
          mimeType: 'image/png',
          data: base64
        }
      });
    });
    let result: GenerationResult | null = null;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[VTO-QualityChecker] Calling Gemini API, attempt ${attempt}...`);
        result = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [
            {
              role: 'user',
              parts
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          },
          safetySettings,
          config: {
            systemInstruction: {
              role: "system",
              parts: [
                {
                  text: systemPrompt
                }
              ]
            }
          }
        });
        lastError = null; // Clear error on success
        break; // Exit loop on success
      } catch (error) {
        lastError = error;
        console.warn(`[VTO-QualityChecker] Attempt ${attempt} failed:`, error.message);
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }
      }
    }
    if (lastError) {
      throw lastError;
    }
    if (!result || !result.text) {
      throw new Error("AI model failed to respond after all retries.");
    }
    const responseJson = extractJson(result.text);
    const { action, best_image_index, reasoning } = responseJson;
    if (!action || typeof best_image_index !== 'number' || !reasoning) {
      throw new Error("AI did not return a valid response with action, best_image_index, and reasoning.");
    }
    console.warn(`[VTO_QA_DECISION] Full AI Response: ${JSON.stringify(responseJson)}`);
    return new Response(JSON.stringify(responseJson), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error("[VTO-QualityChecker] Error:", error);
    console.warn(`[VTO-QualityChecker-FALLBACK] The tool encountered an unrecoverable error. Returning a structured failure report to the worker.`);
    const errorReport = {
        action: "retry", // Tell the worker to retry the generation
        best_image_index: 0, // Must provide a valid index, even on failure
        reasoning: "The Quality Assurance AI failed to produce a valid analysis. This may be a temporary issue. Retrying the generation pass is recommended.",
        error: `Analysis failed: ${error.message}`
    };
    return new Response(JSON.stringify(errorReport), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200, // Return 200 OK so the calling function doesn't crash
    });
  }
});