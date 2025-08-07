import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Master Prompt Architect" AI. Your task is to translate a user's brief into a structured, technical prompt for a photorealistic model generator. Your output MUST be a single block of text formatted as a list of technical parameters.

### Output Format & Rules (CRITICAL):
1.  **Framing (First Line):** The prompt MUST begin with the line: \`PHOTOGRAPHY_STYLE: Full body shot of a model, hyperrealistic, 8k UHD, sharp focus.\`
2.  **Model Description:** The next line MUST be \`MODEL_DESCRIPTION: [Your detailed description of the model based on the user's input, enriched with realism keywords].\`
3.  **Technical Directives:** The following lines MUST be a list of technical parameters, each on a new line.
    - \`POSE: Neutral, frontal, standing A-pose, arms relaxed at sides, neutral facial expression.\`
    - \`CLOTHING: [Your gender-specific clothing description, e.g., 'Simple, plain grey boxer shorts only.']\`
    - \`BACKGROUND: Seamless, plain, non-textured, neutral grey studio backdrop.\`
    - \`LIGHTING: Soft, even, diffuse professional studio lighting, no harsh shadows.\`
    - \`CAMERA_VIEW: Entire body visible from head to toe. Hands and feet must be fully visible and anatomically correct.\`

### Example:
-   **User Input:** "a tall female model with long brown hair"
-   **Your Output:**
PHOTOGRAPHY_STYLE: Full body shot of a model, hyperrealistic, 8k UHD, sharp focus.
MODEL_DESCRIPTION: A tall female model with long brown hair, extremely detailed skin texture with visible pores, hair rendered with individual strands.
POSE: Neutral, frontal, standing A-pose, arms relaxed at sides, neutral facial expression.
CLOTHING: Simple, plain grey bra and matching simple grey underwear only.
BACKGROUND: Seamless, plain, non-textured, neutral grey studio backdrop.
LIGHTING: Soft, even, diffuse professional studio lighting, no harsh shadows.
CAMERA_VIEW: Entire body visible from head to toe. Hands and feet must be fully visible and anatomically correct.
`;

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { model_description, set_description } = await req.json();
    if (!model_description) {
      throw new Error("model_description is required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const userPrompt = `Model Description: "${model_description}"\nSet Description: "${set_description || 'a minimal studio with a neutral background'}"`;

    let result: GenerationResult | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[GenerateModelPromptTool] Calling Gemini API, attempt ${attempt}/${MAX_RETRIES}...`);
            result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
            });

            if (result?.text) {
                lastError = null;
                break; 
            }
            
            console.warn(`[GenerateModelPromptTool] Attempt ${attempt} resulted in an empty or blocked response. Full response:`, JSON.stringify(result, null, 2));
            lastError = new Error("AI model returned an empty or blocked response.");

        } catch (error) {
            lastError = error;
            console.warn(`[GenerateModelPromptTool] Attempt ${attempt} failed:`, error.message);
        }

        if (attempt < MAX_RETRIES) {
            const delay = RETRY_DELAY_MS * attempt;
            console.log(`[GenerateModelPromptTool] Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    if (lastError) {
        console.error(`[GenerateModelPromptTool] All retries failed. Last error:`, lastError.message);
        throw lastError;
    }

    if (!result || !result.text) {
        console.error("[GenerateModelPromptTool] AI model failed to return a valid text response after all retries. Full response:", JSON.stringify(result, null, 2));
        throw new Error("AI model failed to respond with valid text after all retries.");
    }

    const finalPrompt = result.text.trim();

    return new Response(JSON.stringify({ final_prompt: finalPrompt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[GenerateModelPromptTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});