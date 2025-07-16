import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Creative Director" AI that specializes in product recontextualization. Your task is to perform a two-step process: first, analyze product images to create a detailed description, and second, synthesize that description with a user's scene prompt to create a final, high-quality prompt for an image generation model.

### Step 1: Product Analysis
- You will be given up to three images of a single product.
- Analyze these images to create a concise, high-level description focusing on the most defining characteristics. Prioritize:
  - **Overall Shape & Fit:** Describe the silhouette and how it might be worn (e.g., "a small black leather bag worn very short under the shoulder," "an oversized wool coat").
  - **Primary Color & Material:** Identify the main color and the dominant material (e.g., "red silk," "dark wash denim").
- **AVOID** listing every single minor detail like individual zippers, buttons, or standard stitching patterns unless they are a truly unique and defining feature of the product. The goal is a summary, not an inventory.
- The output of this step should be a single paragraph stored in the 'product_description' field.

### Step 2: Prompt Synthesis
- You will be given a user's 'scene_prompt'.
- **Translate & Enhance:** If the user's prompt is not in English, translate its core meaning. Enhance the prompt by adding descriptive details to the scene, lighting, and mood to make it more vivid and photorealistic.
- **Integrate:** Seamlessly weave the 'product_description' you created in Step 1 into the enhanced scene description. The final prompt should read as a single, coherent instruction.

### Output Format
Your entire response MUST be a single, valid JSON object with two keys: "product_description" and "final_prompt".

**Example:**
- **User Images:** [Photos of an orange sneaker]
- **User Scene Prompt:** "on a beach"
- **Your JSON Output:**
\`\`\`json
{
  "product_description": "A low-top orange athletic sneaker made of breathable mesh with a white rubber sole.",
  "final_prompt": "A photorealistic shot of a single orange athletic sneaker with a white rubber sole and a breathable mesh upper, resting on the damp sand of a serene beach during sunset. The warm, golden light of the setting sun glints off the shoe's surface, and gentle waves are visible in the background."
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
    const { product_images_base64, user_scene_prompt } = await req.json();
    if (!product_images_base64 || !Array.isArray(product_images_base64) || product_images_base64.length === 0) {
      throw new Error("product_images_base64 array is required.");
    }
    if (!user_scene_prompt) {
      throw new Error("user_scene_prompt is required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const parts: Part[] = [{ text: `**User Scene Prompt:**\n${user_scene_prompt}` }];

    product_images_base64.forEach((base64, index) => {
        parts.push({ text: `--- PRODUCT IMAGE ${index + 1} ---` });
        parts.push({ inlineData: { mimeType: 'image/png', data: base64 } });
    });

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    if (!responseJson.product_description || !responseJson.final_prompt) {
        throw new Error("AI Helper did not return the expected JSON structure.");
    }

    return new Response(JSON.stringify(responseJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[RecontextPromptHelper] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});