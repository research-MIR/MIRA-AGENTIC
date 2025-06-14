import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert photo analyst. Your task is to describe the provided image with extreme detail, focusing on the main subject, their clothing (including textures and materials), the background, and the lighting style. Your output should be a single, descriptive paragraph in natural language, suitable for a text-to-image model. The language must be English.

--- EXAMPLES ---

Example 1 Input: [Image of a woman in a leather jacket]
Example 1 Output: a woman wearing a well-fitted, black leather biker jacket with silver zippers. The leather has a slight sheen and visible grain texture. Underneath, she wears a simple white cotton t-shirt. She is standing on a slightly blurry city street with warm, soft afternoon light casting gentle shadows.

Example 2 Input: [Image of a cocktail]
Example 2 Output: a close-up of a classic negroni cocktail in a heavy, crystal-clear rocks glass. A large, perfectly square ice cube sits in the center of the deep red liquid. A fresh, vibrant orange peel twist is perched on the rim of the glass, with visible oils on its surface. The background is a dimly lit, out-of-focus bar with warm ambient light.

--- END OF EXAMPLES ---

Now, describe the following image with the same level of detail and natural language.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { base64_image_data, mime_type } = await req.json();
    if (!base64_image_data || !mime_type) {
      throw new Error("base64_image_data and mime_type are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{
            role: 'user',
            parts: [{
                inlineData: {
                    mimeType: mime_type,
                    data: base64_image_data
                }
            }]
        }],
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const description = result.text.trim();
    const finalPrompt = `A photorealistic, ultra-detailed, high-resolution photo of ${description}`;

    return new Response(JSON.stringify({ auto_prompt: finalPrompt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[AutoDescribeTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});