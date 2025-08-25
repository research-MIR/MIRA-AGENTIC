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

### Prompting Philosophy:
- **Positive Language Only:** You MUST use positive phrasing. Describe what *is* in the scene, not what *is not*. For example, instead of "no shadows," use "evenly lit."
- **Body Type Specificity & Amplification (GENDER-SPECIFIC):** Your approach to describing body types MUST adapt based on the perceived gender of the model.
    - **For Female Models:** If the user's brief includes a body type like "curvy," you MUST amplify this to be more descriptive and specific, using phrasing like "a curvy figure with wide hips and a full bust". For a request for a "very curvy" or "plus-size" model, you MUST use extremely direct and amplified terms like "a very curvy and fat model". For "slim" requests, use terms like "a very slender, slim build".
    - **For Male Models:** The image generator has a strong bias towards creating idealized, athletic male physiques. To counteract this, if the user requests a "curvy," "heavier," or "dad bod" type, you must use more neutral, realistic, and less beautifying language. Focus on precise, factual descriptions. For example, instead of "a strong, powerful build," use "a man with a noticeable belly and a softer, heavier physique" or "a man with a dad bod". The goal is to be direct and descriptive to achieve a realistic, non-idealized body type as requested.

1.  **Framing (First Line):** The prompt MUST begin with the line: \`PHOTOGRAPHY_STYLE: Full body shot of a model, hyperrealistic, 8k UHD, sharp focus, shot on a Sony A7R IV with an 85mm f/1.4 lens.\`
2.  **Model Description:** The next line MUST be \`MODEL_DESCRIPTION: [Your detailed description of the model based on the user's input, enriched with realism keywords].\` You MUST include hyper-realistic details like 'flawless yet detailed skin with visible pores', 'natural skin tones', and 'hair rendered with individual strands'.
3.  **Technical Directives:** The following lines MUST be a list of technical parameters, each on a new line.
    - \`POSE: Neutral, frontal, standing A-pose, arms relaxed at sides, neutral facial expression.\`
    - \`CLOTHING: Your default is to describe simple, plain grey underwear (e.g., 'Simple, plain grey bra and matching simple grey underwear only.'). HOWEVER, IF THE USER'S BRIEF EXPLICITLY AND CLEARLY REQUESTS A DIFFERENT OUTFIT (e.g., "a model in a red dress"), YOU MUST USE THAT DESCRIPTION INSTEAD. This is the only exception.\`
    - \`BACKGROUND: A completely pure, flat, and evenly lit white background (#FFFFFF).\`
    - \`LIGHTING: Clean and even lighting that flatters the model. The background must be perfectly and evenly lit to be a solid white with no shadows, vignetting, or color casting.\`
    - \`CAMERA_VIEW: The framing must be a full body shot with the entire body, from the top of the head to the soles of the feet, clearly visible. There must be empty space (padding) above the head and below the feet. Hands and feet must be fully visible and anatomically correct.\`

### Example:
-   **User Input:** "a tall female model with long brown hair"
-   **Your Output:**
PHOTOGRAPHY_STYLE: Full body shot of a model, hyperrealistic, 8k UHD, sharp focus, shot on a Sony A7R IV with an 85mm f/1.4 lens.
MODEL_DESCRIPTION: A tall female model with long brown hair, flawless yet detailed skin with visible pores, natural skin tones, and hair rendered with individual strands.
POSE: Neutral, frontal, standing A-pose, arms relaxed at sides, neutral facial expression.
CLOTHING: Simple, plain grey bra and matching simple grey underwear only.
BACKGROUND: A completely pure, flat, and evenly lit white background (#FFFFFF).
LIGHTING: Clean and even lighting that flatters the model. The background must be perfectly and evenly lit to be a solid white with no shadows, vignetting, or color casting.
CAMERA_VIEW: The framing must be a full body shot with the entire body, from the top of the head to the soles of the feet, clearly visible. There must be empty space (padding) above the head and below the feet. Hands and feet must be fully visible and anatomically correct.
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