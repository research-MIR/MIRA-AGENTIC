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
    console.log("[SegmentImageTool] Attempting to extract JSON from model response.");
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        console.log("[SegmentImageTool] Extracted JSON from markdown block.");
        return JSON.parse(match[1]);
    }
    try {
        console.log("[SegmentImageTool] Attempting to parse raw text as JSON.");
        return JSON.parse(text);
    } catch (e) {
        console.error("[SegmentImageTool] Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    console.log("[SegmentImageTool] Handling OPTIONS preflight request.");
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log("[SegmentImageTool] Function invoked.");
    const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type } = await req.json();
    if (!image_base64 || !mime_type || !prompt) {
      throw new Error("image_base64, mime_type, and prompt are required.");
    }
    console.log(`[SegmentImageTool] Received prompt: "${prompt.substring(0, 50)}..."`);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const userParts: Part[] = [
        { text: "SOURCE IMAGE:" },
        { inlineData: { mimeType: mime_type, data: image_base64 } },
    ];

    if (reference_image_base64 && reference_mime_type) {
        console.log("[SegmentImageTool] Reference image provided. Adding to payload.");
        userParts.push(
            { text: "REFERENCE IMAGE:" },
            { inlineData: { mimeType: reference_mime_type, data: reference_image_base64 } }
        );
    }

    userParts.push({ text: prompt });

    const contents: Content[] = [{ role: 'user', parts: userParts }];

    console.log("[SegmentImageTool] Calling Gemini API...");
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
        generationConfig: {
            responseMimeType: "application/json",
        },
        safetySettings,
    });

    console.log("[SegmentImageTool] Received response from Gemini.");
    const responseJson = extractJson(result.text);
    console.log(`[SegmentImageTool] Successfully parsed JSON. Found ${responseJson.masks?.length || 'unknown'} masks.`);

    return new Response(JSON.stringify(responseJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[SegmentImageTool] Unhandled Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});