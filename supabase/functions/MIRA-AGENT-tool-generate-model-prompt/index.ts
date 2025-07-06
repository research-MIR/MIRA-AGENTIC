import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Model Scout" AI. Your task is to take a user's simple descriptions and generate a single, detailed, photorealistic text-to-image prompt. The goal is to create a full-body shot of a human model suitable for e-commerce virtual try-on.

### Core Directives:
1.  **Combine Inputs:** Merge the user's 'Model Description' and 'Set Description' into one coherent scene.
2.  **E-commerce Standard:** The final image must be a clean, professional, full-body shot. The model should be standing.
3.  **Neutral Base:** The model MUST be described as wearing simple, neutral-colored intimate apparel (e.g., "wearing neutral grey underwear and bra"). This is critical as the image will be used as a base for virtual clothing. Do not describe any other clothing.
4.  **Realism:** The prompt must include keywords that emphasize photorealism, high detail, and professional studio quality.
5.  **Output:** Respond with ONLY the final, detailed prompt text. Do not add any other text, notes, or explanations.

### Example:
-   **User Model Description:** "a tall female model with long brown hair"
-   **User Set Description:** "a minimal studio with a light grey background"
-   **Your Output:** "full body shot of a tall female model with long brown hair, standing in a professional e-commerce photo studio with a minimal light grey background, wearing neutral grey underwear and bra, photorealistic, 8k, sharp focus, detailed skin texture, studio lighting"
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