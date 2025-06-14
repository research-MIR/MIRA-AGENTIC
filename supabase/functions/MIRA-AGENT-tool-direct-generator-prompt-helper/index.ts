import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const garmentAnalysisPrompt = `You are a fashion expert. Your task is to analyze the provided image and describe the main garment being worn in a concise, descriptive phrase. Focus on color, pattern, and type. Example: "a white t-shirt with red and green stripes". Respond with only the description.`;

const styleAnalysisPrompt = `You are a professional photographer and art director. Analyze the provided image and describe its key stylistic elements. Respond with a JSON object with the following keys: "photography_style" (e.g., "cinematic, editorial fashion"), "lighting" (e.g., "soft, diffused natural light"), "color_palette" (e.g., "warm, earthy tones"), and "subject_pose" (e.g., "standing with hands on hips").`;

const synthesisSystemPrompt = `You are a master prompt crafter. Your task is to combine the following elements into a single, coherent, and detailed text-to-image prompt. The final prompt MUST be in English.

**Elements to Combine:**
1.  **Base Prompt:** The user's original text.
2.  **Garment Description:** A description of a garment from a reference image. You MUST intelligently insert this into the base prompt. If the base prompt mentions a generic 'garment' or 'clothing', replace it. Otherwise, add it to the subject's description.
3.  **Style Analysis:** A JSON object describing the style of a second reference image.
4.  **User Instructions on Style:** The user's base prompt may contain instructions on how to use the style (e.g., "use the pose from the reference"). You must follow these instructions, using the corresponding value from the Style Analysis.

Combine these elements into a final, rich, photorealistic prompt in English. Do not respond in JSON, only the final text prompt.`;

async function analyzeImage(ai: GoogleGenAI, imageUrl: string, systemPrompt: string, isJsonOutput: boolean = false): Promise<any> {
    if (!SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Supabase API keys are not set in environment variables.");
    }
    const response = await fetch(imageUrl, {
        headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'apikey': SUPABASE_ANON_KEY
        }
    });
    if (!response.ok) throw new Error(`Failed to download image from ${imageUrl}`);
    const mimeType = response.headers.get("content-type") || "image/png";
    const buffer = await response.arrayBuffer();
    const base64 = encodeBase64(buffer);

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: base64 } }] }],
        generationConfig: isJsonOutput ? { responseMimeType: "application/json" } : undefined,
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });
    return isJsonOutput ? JSON.parse(result.text) : result.text.trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { user_prompt, garment_image_url, style_image_url } = await req.json();
    if (!user_prompt) throw new Error("user_prompt is required.");

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    let garmentDescription = "";
    let styleAnalysis = {};

    if (garment_image_url) {
        console.log("Analyzing garment image...");
        garmentDescription = await analyzeImage(ai, garment_image_url, garmentAnalysisPrompt);
        console.log("Garment description:", garmentDescription);
    }

    if (style_image_url) {
        console.log("Analyzing style image...");
        styleAnalysis = await analyzeImage(ai, style_image_url, styleAnalysisPrompt, true);
        console.log("Style analysis:", styleAnalysis);
    }

    const synthesisParts: Part[] = [
        { text: `**Base Prompt:**\n${user_prompt}` }
    ];
    if (garmentDescription) {
        synthesisParts.push({ text: `\n\n**Garment to Insert:**\n${garmentDescription}` });
    }
    if (Object.keys(styleAnalysis).length > 0) {
        synthesisParts.push({ text: `\n\n**Style Analysis:**\n${JSON.stringify(styleAnalysis, null, 2)}` });
    }

    console.log("Synthesizing final prompt...");
    const finalResult = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: synthesisParts }],
        config: { systemInstruction: { role: "system", parts: [{ text: synthesisSystemPrompt }] } }
    });

    const finalPrompt = finalResult.text.trim();
    console.log("Final synthesized prompt:", finalPrompt);

    return new Response(JSON.stringify({ final_prompt: finalPrompt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[PromptHelper] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});