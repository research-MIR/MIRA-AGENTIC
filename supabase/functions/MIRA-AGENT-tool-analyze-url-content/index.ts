import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert "Visual Analyzer" AI. You have been given a URL. Your task is to perform a deep analysis of the visual identity of the webpage at this URL.

**Your Instructions:**
1.  Analyze the first 3-4 main images on the page.
2.  For each image, provide a detailed breakdown covering:
    -   image_description: A clear, detailed description of what is depicted.
    -   lighting_style: The specific type of lighting used (e.g., "Soft, diffused natural light," "Hard, direct studio lighting").
    -   photography_style: The specific photographic genre (e.g., "Editorial fashion," "Lifestyle product shot").
    -   composition_and_setup: How the shot is framed and arranged.
3.  Identify the dominant colors of the overall website as an array of hex codes.
4.  Provide a final 'synthesis' that summarizes the brand's overall visual aesthetic and mood based on your analysis.
5.  Return your entire analysis as a single, valid JSON object. Do not include any text outside of the JSON.
`;

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) { return JSON.parse(match[1]); }
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  try {
    const { url } = await req.json();
    if (!url) { throw new Error("Missing 'url' in request body"); }

    console.log(`[UrlAnalysisTool] Received URL: ${url}`);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    console.log(`[UrlAnalysisTool] Calling Gemini with urlContext...`);
    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [{ role: 'user', parts: [{ text: `Please analyze the content of this URL: ${url}` }] }],
      config: {
        systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
        tools: [{ urlContext: {} }]
      }
    });

    const analysisText = result.text;
    if (!analysisText) { throw new Error("Model failed to generate an analysis report."); }
    
    console.log(`[UrlAnalysisTool] Received analysis from Gemini. Length: ${analysisText.length}`);
    const finalJson = extractJson(analysisText);

    return new Response(JSON.stringify(finalJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error("[UrlAnalysisTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});