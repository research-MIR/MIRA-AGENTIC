import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert at parsing high-level requests into structured data. Your task is to take a user's description of multiple models and break it down into a list of simple, individual model descriptions.

### Core Directives:
1.  **Identify Individuals:** Carefully read the user's prompt and identify each distinct model they are describing.
2.  **Create Simple Descriptions:** For each model, create a concise, one-sentence description.
3.  **Output JSON Array:** Your entire response MUST be a single, valid JSON object with one key, "model_descriptions". The value must be an array of strings, where each string is a simple description of one model.

### Example:
-   **User Input:** "three red head models, one fatter one slimmer one medium, and a model male with black hair"
-   **Your Output:**
    \`\`\`json
    {
      "model_descriptions": [
        "a red-headed model, fatter build",
        "a red-headed model, slimmer build",
        "a red-headed model, medium build",
        "a male model with black hair"
      ]
    }
    \`\`\`
`;

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
    const { high_level_prompt } = await req.json();
    if (!high_level_prompt) {
      throw new Error("high_level_prompt is required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [{ text: high_level_prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const modelDescriptions = responseJson.model_descriptions;

    if (!modelDescriptions || !Array.isArray(modelDescriptions)) {
        throw new Error("AI did not return a valid 'model_descriptions' array.");
    }

    return new Response(JSON.stringify({ model_descriptions: modelDescriptions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ParseMultiModelTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});