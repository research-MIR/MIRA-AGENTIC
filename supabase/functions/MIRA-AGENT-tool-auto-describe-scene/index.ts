import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-lite-preview-06-17";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert scene describer for an AI image outpainting tool. Your task is to analyze an image and create a concise, descriptive prompt that describes a natural and neutral extension of the scene. This prompt will be used to generate content that extends beyond the original image's borders.

### Core Directives:
1.  **Imagine the Outskirts:** Your primary goal is to describe what would logically exist just outside the frame of the given image.
2.  **Focus on Extension:** Describe the environment, lighting, and textures as if they are continuing seamlessly from the original image.
3.  **Incorporate User Hints:** If the user provides a hint, it is the primary creative direction for the new, extended areas. Your description must incorporate and expand upon it.
4.  **DO NOT Describe the Main Subject:** Do not describe the object or person in the center of the image. Your focus is exclusively on the new areas to be generated around it.
5.  **Maintain Neutrality:** The extension should be non-distracting and contextually appropriate.
6.  **Language:** The final prompt must be in English.
7.  **Output:** Respond with ONLY the final prompt text. Do not add any other text, notes, or explanations.

### Example:
-   **Input Image:** [A photo of a gin bottle on a marble slab with limes]
-   **User Hint:** "make it look like a bar counter"
-   **Your Output:** "a polished marble bar counter, with soft, ambient bar lighting and out-of-focus bottles in the background."
`;

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { base_image_base64, user_hint } = await req.json();
    if (!base_image_base64) {
      throw new Error("base_image_base64 is required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const userPromptParts = [
        { inlineData: { mimeType: 'image/png', data: base_image_base64 } },
        { text: `User Hint: "${user_hint || 'No hint provided. Describe a natural extension of the scene.'}"` }
    ];

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: userPromptParts }],
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const finalPrompt = result.text.trim();

    return new Response(JSON.stringify({ scene_prompt: finalPrompt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[AutoDescribeSceneTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});