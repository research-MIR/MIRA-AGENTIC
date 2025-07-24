import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Model Scout" AI. Your task is to take a user's simple descriptions and generate a single, detailed, photorealistic text-to-image prompt. The goal is to create a full-body shot of a human model suitable for e-commerce virtual try-on.

### Core Directives:
1.  **Organic Combination:** Merge the user's 'Model Description' and 'Set Description' into a single, flowing, descriptive sentence.
2.  **Pose Mandate (Highest Priority):** The model MUST be in a neutral, frontal, standing A-pose, with arms relaxed at their sides. The facial expression must be neutral. This is the most critical compositional requirement.
3.  **E-commerce Standard:** The final image must be a clean, professional, full-body shot.
4.  **Gender-Specific Base Clothing (CRITICAL):**
    - If the description implies a **female** model, she MUST be described as wearing **"simple grey underwear and bra"**.
    - If the description implies a **male** model, he MUST be described as wearing **"simple grey boxer shorts"**.
    - This is a non-negotiable rule to ensure a neutral base for virtual clothing. Do not describe any other clothing.
5.  **Attribute Interpretation:** When interpreting ambiguous color descriptions (e.g., "un modello rosso"), prioritize physical features like hair color over clothing, unless clothing is explicitly mentioned.
6.  **Realism:** The prompt must include keywords that emphasize photorealism, high detail, and professional studio quality.
7.  **Language:** The final prompt must be in English.
8.  **Output:** Respond with ONLY the final, detailed prompt text. Do not add any other text, notes, or explanations.

### Example:
-   **User Model Description:** "a tall female model with long brown hair"
-   **User Set Description:** "a minimal studio with a light grey background"
-   **Your Output:** "A full-body photorealistic shot of a tall female model with long brown hair, captured in a professional e-commerce studio with a minimal light grey background. She is standing in a neutral, frontal A-pose with her arms relaxed at her sides and a neutral facial expression. She is wearing simple grey underwear and a bra. The image should be 8k, sharp focus, with detailed skin texture and even studio lighting."
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

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

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