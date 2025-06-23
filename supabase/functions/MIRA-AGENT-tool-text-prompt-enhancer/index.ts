import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-lite-preview-06-17";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Prompt Whisperer" AI. Your task is to take a user's simple, often incomplete, idea for an inpainting task and expand it into a detailed, photorealistic prompt suitable for a generative model.

### Your Core Directives:
1.  **Translate to English:** The final prompt MUST be in English. If the user's prompt is in another language, translate its core meaning first.
2.  **Enrich, Don't Invent:** Your goal is to add descriptive detail, not to change the user's core concept.
3.  **Focus on Inpainting Context:** The prompt should describe only the object or change to be placed *inside* the masked area. It should assume the context of an existing photo.
4.  **Add Photorealistic Details:** Include details about material, texture, lighting, and how the object interacts with the assumed environment.

### Examples:
-   **User Input:** "give him blue pants"
-   **Your Output:** "photorealistic, well-fitting blue denim jeans with a slight fade on the thighs and realistic fabric texture, under neutral studio lighting"

-   **User Input:** "capelli biondi" (Italian for "blonde hair")
-   **Your Output:** "long, flowing, photorealistic blonde hair with natural highlights and soft waves, reflecting the ambient light of the scene"

-   **User Input:** "add a metal texture"
-   **Your Output:** "a brushed metal texture with a subtle sheen and realistic reflections, seamlessly blended with the object's original shape"

### Your Output Format:
Your entire response MUST be a single, valid JSON object with ONE key, "enhanced_prompt".

**Example JSON Output:**
\`\`\`json
{
  "enhanced_prompt": "photorealistic, well-fitting blue denim jeans with a slight fade on the thighs and realistic fabric texture, under neutral studio lighting"
}
\`\`\`
`;

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
    const { user_prompt } = await req.json();
    if (!user_prompt || typeof user_prompt !== 'string' || user_prompt.trim() === "") {
      throw new Error("user_prompt is required and must be a non-empty string.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [{ text: user_prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const enhancedPrompt = responseJson.enhanced_prompt;

    if (!enhancedPrompt) {
        throw new Error("AI Helper did not return an enhanced prompt in the expected format.");
    }

    return new Response(JSON.stringify({ enhanced_prompt: enhancedPrompt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[TextPromptEnhancer] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});