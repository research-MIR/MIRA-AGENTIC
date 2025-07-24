import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert fashion cataloger. Analyze the provided garment image and return a JSON object with the following attributes:

*   **\`type_of_fit\`**: Your assessment of which part of the body the garment covers. Must be one of: **'upper body'**, **'lower body'**, or **'full body'**. (e.g., a bra is 'upper body', boxer shorts are 'lower body', a dress is 'full body').
*   **\`intended_gender\`**: Your assessment of the target gender. Must be one of: **'female'**, **'male'**, or **'unisex'**. **Use 'unisex' sparingly**, only for items that are truly gender-neutral like scarves or some hats.
*   \`primary_color\`: The dominant color.
*   \`style_tags\`: An array of relevant style keywords.

Your entire response must be only the valid JSON object.`;

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
    const { image_base64, mime_type } = await req.json();
    if (!image_base64 || !mime_type) {
      throw new Error("image_base64 and mime_type are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{
            role: 'user',
            parts: [{
                inlineData: {
                    mimeType: mime_type,
                    data: image_base64
                }
            }]
        }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const analysis = extractJson(result.text);

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[AnalyzeGarmentTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});