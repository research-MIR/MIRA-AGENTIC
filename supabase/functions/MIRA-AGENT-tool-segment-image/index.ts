import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20"; // Using Flash for cost-effectiveness

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
    const { image_base64, mime_type, prompt } = await req.json();
    if (!image_base64 || !mime_type || !prompt) {
      throw new Error("image_base64, mime_type, and prompt are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const contents: Content[] = [{
        role: 'user',
        parts: [
            { inlineData: { mimeType: mime_type, data: image_base64 } },
            { text: prompt }
        ]
    }];

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
        generationConfig: {
            responseMimeType: "application/json",
        },
        safetySettings,
    });

    const responseJson = extractJson(result.text);

    return new Response(JSON.stringify(responseJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[SegmentImageTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});