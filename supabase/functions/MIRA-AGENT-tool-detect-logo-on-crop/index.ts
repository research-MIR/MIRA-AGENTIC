import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest"; // Flash is perfect for this simple task

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const systemPrompt = `You are a logo detection specialist. Your only task is to analyze the provided image and determine if a visible logo, brand mark, or emblem is present. You MUST respond with only a valid JSON object with a single boolean key: "logo_present". Do not include any other text or explanations.`;

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        return JSON.parse(match[1]);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("[LogoDetector] Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { image_base64, mime_type } = await req.json();
  const requestId = `logo-detector-${Date.now()}`;
  console.log(`[LogoDetector][${requestId}] Invoked.`);

  try {
    if (!image_base64 || !mime_type) {
      throw new Error("image_base64 and mime_type are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const userParts: Part[] = [
        { inlineData: { mimeType: mime_type, data: image_base64 } },
        { text: "Analyze this image for a logo based on the system instructions." }
    ];
    const contents: Content[] = [{ role: 'user', parts: userParts }];

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
        generationConfig: { responseMimeType: "application/json" },
        safetySettings,
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    
    if (typeof responseJson.logo_present !== 'boolean') {
        throw new Error("Model response did not contain a valid 'logo_present' boolean field.");
    }

    console.log(`[LogoDetector][${requestId}] Detection complete. Logo present: ${responseJson.logo_present}`);

    return new Response(JSON.stringify({ logo_present: responseJson.logo_present }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[LogoDetector][${requestId}] Error:`, error);
    // Fail gracefully by returning false, so the main process isn't blocked.
    return new Response(JSON.stringify({ error: error.message, logo_present: false }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});