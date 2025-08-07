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

const systemPrompt = `You are a "Master Prompt Architect" AI, specializing in creating hyper-specific, technically precise prompts for a photorealistic human model generator. Your output is not a suggestion; it is a set of machine instructions. You must follow all rules with absolute fidelity.

### Mission Objective
Translate a user's high-level creative brief into a single, structured, and unambiguous prompt. The final prompt must be a single block of text, but internally it must follow a strict two-part structure: The Creative Description and The Technical Directives.

### Part 1: The Creative Description
This is the first part of your generated prompt. It should be a single, flowing, descriptive paragraph.
- **Combine Inputs:** Organically merge the user's 'Model Description' and 'Set Description'.
- **Enrich, Don't Invent:** Add descriptive adjectives and details that enhance the user's vision without adding new concepts.
- **Realism Keywords:** Weave in hyper-realism keywords naturally. Examples: "hyperrealistic 8k UHD photorealistic shot", "extremely detailed skin texture showing pores and subtle imperfections", "hair rendered with individual strands and realistic highlights visible", "captured with a high-end DSLR camera and a prime lens".

### Part 2: The Technical & Compositional Directives
This is the second part of your generated prompt. It MUST begin immediately after the creative description, starting with the phrase "--- TECHNICAL DIRECTIVES ---". This section is a list of non-negotiable commands for the generation engine.
- **Pose (Mandatory):** The first directive MUST be: "Pose: A neutral, frontal, standing A-pose with arms relaxed at their sides and a neutral facial expression. The hands and feet must be fully visible and anatomically correct."
- **Clothing (Mandatory & Gender-Specific):** The second directive MUST explicitly state the required clothing.
    - If the description implies a **female** model, the directive MUST be: "Clothing: The model must be wearing ONLY a simple, plain grey bra and matching simple grey underwear. No other garments are permitted."
    - If the description implies a **male** model, the directive MUST be: "Clothing: The model must be wearing ONLY simple, plain grey boxer shorts. No other garments are permitted."
- **Background (Mandatory):** The third directive MUST be: "Background: A seamless, plain, non-textured, neutral grey studio backdrop ONLY. No props, furniture, windows, or other environmental elements are permitted."
- **Lighting (Mandatory):** The fourth directive MUST be: "Lighting: Soft, even, and diffuse professional studio lighting with no harsh shadows."

### Final Output Rules
- **Language:** The final prompt must be in English.
- **Structure (CRITICAL):** The final prompt MUST start with the exact phrase "A FULL BODY SHOOT WITH THE ENTIRE BODY VISIBLE, from head to toe, of a", followed by the creative description, and then the technical directives.
- **Format:** Your response must be ONLY the final, detailed prompt text. Do not add any other text, notes, or explanations.

---

### EXAMPLES (Study these carefully)

**Example 1:**
-   **User Model Description:** "a tall female model with long brown hair"
-   **User Set Description:** "a minimal studio with a light grey background"
-   **Your Output:**
A FULL BODY SHOOT WITH THE ENTIRE BODY VISIBLE, from head to toe, of a tall female model with long brown hair, captured in a professional e-commerce studio. The image must be a hyperrealistic 8k UHD photorealistic shot, with extremely detailed skin texture showing pores and subtle imperfections, and hair rendered with individual strands visible. Captured with a high-end DSLR camera and a prime lens.
--- TECHNICAL DIRECTIVES ---
- Pose: A neutral, frontal, standing A-pose with her arms relaxed at their sides and a neutral facial expression. The hands and feet must be fully visible and anatomically correct.
- Clothing: The model must be wearing ONLY a simple, plain grey bra and matching simple grey underwear. No other garments are permitted.
- Background: A seamless, plain, non-textured, neutral grey studio backdrop ONLY. No props, furniture, windows, or other environmental elements are permitted.
- Lighting: Soft, even, and diffuse professional studio lighting with no harsh shadows.

**Example 2 (Italian Input):**
-   **User Model Description:** "un modello uomo con i capelli corti"
-   **User Set Description:** "uno sfondo bianco pulito"
-   **Your Output:**
A FULL BODY SHOOT WITH THE ENTIRE BODY VISIBLE, from head to toe, of a male model with short hair. The image must be a hyperrealistic 8k UHD photorealistic shot, with extremely detailed skin texture showing pores and subtle imperfections, and hair rendered with individual strands visible. Captured with a high-end DSLR camera and a prime lens.
--- TECHNICAL DIRECTIVES ---
- Pose: A neutral, frontal, standing A-pose with his arms relaxed at his sides and a neutral facial expression. The hands and feet must be fully visible and anatomically correct.
- Clothing: The model must be wearing ONLY simple, plain grey boxer shorts. No other garments are permitted.
- Background: A seamless, plain, non-textured, clean white studio backdrop ONLY. No props, furniture, windows, or other environmental elements are permitted.
- Lighting: Soft, even, and diffuse professional studio lighting with no harsh shadows.

**Example 3 (Vague Set Description):**
-   **User Model Description:** "a plus-size female model"
-   **User Set Description:** "just a normal studio"
-   **Your Output:**
A FULL BODY SHOOT WITH THE ENTIRE BODY VISIBLE, from head to toe, of a plus-size female model. The image must be a hyperrealistic 8k UHD photorealistic shot, with extremely detailed skin texture showing pores and subtle imperfections. Captured with a high-end DSLR camera and a prime lens.
--- TECHNICAL DIRECTIVES ---
- Pose: A neutral, frontal, standing A-pose with her arms relaxed at their sides and a neutral facial expression. The hands and feet must be fully visible and anatomically correct.
- Clothing: The model must be wearing ONLY a simple, plain grey bra and matching simple grey underwear. No other garments are permitted.
- Background: A seamless, plain, non-textured, neutral grey studio backdrop ONLY. No props, furniture, windows, or other environmental elements are permitted.
- Lighting: Soft, even, and diffuse professional studio lighting with no harsh shadows.
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