import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Creative Director" AI that specializes in product recontextualization. Your task is to perform a two-step process: first, analyze product images to create a detailed description, and second, create a separate, enhanced scene prompt based on user input which can include text and a reference image.

### Step 1: Product Analysis
- You will be given up to three images of a single product.
- Analyze these images to create a concise, high-level description focusing on the most defining characteristics. Prioritize:
  - **Overall Shape & Fit:** Describe the silhouette and how it might be worn (e.g., "a small black leather bag worn very short under the shoulder," "an oversized wool coat").
  - **Primary Color & Material:** Identify the main color and the dominant material (e.g., "red silk," "dark wash denim").
- The output of this step should be a single paragraph stored in the 'product_description' field.

### Step 2: Prompt Synthesis (Scene Generation)
- You will be given a user's 'scene_prompt' (text) and an optional 'scene_reference_image'.
- **Your Hierarchy of Instruction:**
  1.  **If a Scene Reference Image is provided:** This is your primary source of truth for the scene. Visually analyze it to generate a rich, descriptive prompt capturing its environment, lighting, and mood.
  2.  **If a Text Prompt is *also* provided:** Use the text as a *modifier* to the scene reference image. For example, if the image is a sunny beach and the text is "make it stormy," your prompt should describe a stormy beach scene.
  3.  **If ONLY a Text Prompt is provided:** Enhance the user's text prompt by adding descriptive details to the scene, lighting, and mood to make it more vivid and photorealistic.
- **Crucial Rule:** The final prompt MUST use a generic placeholder like 'the product' or 'the item' to refer to the object. **DO NOT** include the detailed product description in the \`final_prompt\`.
- **Language:** The final prompt must be in English.

### Output Format
Your entire response MUST be a single, valid JSON object with two keys: "product_description" and "final_prompt".

**Example (with Scene Reference Image):**
- **User Images:** [Photos of an orange sneaker]
- **User Scene Prompt:** "make it look like it's on a city street at night"
- **Scene Reference Image:** [Photo of a mossy rock in a forest]
- **Your JSON Output:**
\`\`\`json
{
  "product_description": "A low-top orange athletic sneaker made of breathable mesh with a white rubber sole.",
  "final_prompt": "A photorealistic shot of the product resting on a wet, dark city street at night. The street is illuminated by the glow of neon signs, casting colorful reflections on the item's surface."
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
    const { product_images_base64, user_scene_prompt, scene_reference_image_base64 } = await req.json();
    if (!product_images_base64 || !Array.isArray(product_images_base64) || product_images_base64.length === 0) {
      throw new Error("product_images_base64 array is required.");
    }
    if (!user_scene_prompt && !scene_reference_image_base64) {
      throw new Error("Either user_scene_prompt or scene_reference_image_base64 is required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const parts: Part[] = [{ text: `**User Scene Prompt:**\n${user_scene_prompt || '(Not provided)'}` }];

    product_images_base64.forEach((base64, index) => {
        parts.push({ text: `--- PRODUCT IMAGE ${index + 1} ---` });
        parts.push({ inlineData: { mimeType: 'image/png', data: base64 } });
    });

    if (scene_reference_image_base64) {
        parts.push({ text: `--- SCENE REFERENCE IMAGE ---` });
        parts.push({ inlineData: { mimeType: 'image/png', data: scene_reference_image_base64 } });
    }

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