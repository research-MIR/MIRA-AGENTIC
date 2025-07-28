import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000; // Initial delay, will be multiplied by attempt number

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert fashion cataloger. Analyze the provided garment image and return a JSON object with the following attributes:

*   **\`type_of_fit\`**: Your assessment of which part of the body the garment covers. It MUST be one of these exact string values: **'upper_body'**, **'lower_body'**, or **'full_body'**. Do NOT use spaces.
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
  const requestId = `analyze-garment-${Date.now()}`;
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { image_base64, mime_type } = await req.json();
    if (!image_base64 || !mime_type) {
      throw new Error("image_base64 and mime_type are required.");
    }
    console.log(`[AnalyzeGarmentTool][${requestId}] Starting analysis.`);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    let result: GenerationResult | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[AnalyzeGarmentTool][${requestId}] Calling Gemini API, attempt ${attempt}/${MAX_RETRIES}...`);
        result = await ai.models.generateContent({
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
        
        lastError = null; // Clear last error on success
        console.log(`[AnalyzeGarmentTool][${requestId}] API call successful on attempt ${attempt}.`);
        break; // Exit the loop on success
      } catch (error) {
        lastError = error;
        console.warn(`[AnalyzeGarmentTool][${requestId}] Attempt ${attempt} failed:`, error.message);
        
        if (error.message.includes("503") && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * attempt; // Exponential backoff
          console.log(`[AnalyzeGarmentTool][${requestId}] Model is overloaded. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Not a retryable error or it's the last attempt, so we'll throw after the loop
          break;
        }
      }
    }

    if (lastError) {
      console.error(`[AnalyzeGarmentTool][${requestId}] All retries failed. Last error:`, lastError.message);
      throw lastError;
    }

    if (!result) {
      throw new Error("AI model failed to respond after all retries.");
    }

    const analysis = extractJson(result.text);
    console.log(`[AnalyzeGarmentTool][${requestId}] Analysis complete. Gender: ${analysis.intended_gender}, Fit: ${analysis.type_of_fit}`);

    return new Response(JSON.stringify(analysis), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[AnalyzeGarmentTool][${requestId}] Unhandled Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});