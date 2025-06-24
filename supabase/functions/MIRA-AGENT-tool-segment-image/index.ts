import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05"; // Upgraded for more complex reasoning

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert fashion AI and virtual stylist. Your primary task is to analyze a PERSON image and a GARMENT image and generate a precise segmentation mask on the PERSON image. This mask represents the area where the garment should be placed, a process we call 'projection masking'.

### Core Rules:
1.  **Analyze the Garment:** First, identify the type of clothing in the GARMENT image (e.g., t-shirt, dress, jacket, pants).
2.  **Analyze the Person:** Identify the corresponding body region on the PERSON image where this garment would be worn.
3.  **The Cover-Up Imperative:** The generated mask must cover the entire area the new garment would occupy. **Crucially, if the person is already wearing clothing in that area, the mask must cover the existing clothing as well.** The goal is to create a clean slate for the new garment.
4.  **Be Generous:** Slightly expand the mask beyond the garment's natural boundaries to ensure a clean replacement and better blending.

### Few-Shot Examples:

**Example 1: T-Shirt over a Long-Sleeve Shirt**
*   **Input:** A person wearing a long-sleeve sweater and a reference image of a t-shirt.
*   **Logic:** The reference is a t-shirt, which covers the torso. The person is currently wearing a long-sleeve sweater. To place the t-shirt, I must completely cover the existing sweater, including the sleeves, even though the new t-shirt doesn't have them. This prepares the entire upper body for the new item.
*   **Output:** A single mask covering the person's entire torso and arms, with the label "Upper Body Area for T-Shirt Placement".

**Example 2: Dress over Pants and Top**
*   **Input:** A person wearing jeans and a blouse, and a reference image of a knee-length dress.
*   **Logic:** The reference is a dress. It covers the torso and legs down to the knee. The person is wearing a blouse and jeans. Therefore, my mask must cover the entire area from the shoulders down to the knees, completely obscuring the original blouse and jeans.
*   **Output:** A single mask covering the person's torso and legs down to the knees, with the label "Full Dress Area for Placement".

**Example 3: Cropped Top over a T-Shirt**
*   **Input:** A person wearing a standard-length t-shirt and a reference image of a short, cropped top.
*   **Logic:** The reference is a cropped top, which is smaller than the existing t-shirt. To ensure the original t-shirt is completely replaced and doesn't peek out from underneath, I must generate a mask that covers the *entire area of the original t-shirt*, not just the smaller area of the cropped top.
*   **Output:** A single mask that covers the full area of the original t-shirt, with the label "Torso Area for Cropped Top Placement".

### Output Format:
Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label".
`;

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
        { text: "PERSON IMAGE:" },
        { inlineData: { mimeType: mime_type, data: image_base64 } },
    ];

    if (reference_image_base64 && reference_mime_type) {
        console.log("[SegmentImageTool] Reference image provided. Adding to payload.");
        userParts.push(
            { text: "GARMENT IMAGE:" },
            { inlineData: { mimeType: reference_mime_type, data: reference_image_base64 } }
        );
    }

    const contents: Content[] = [{ role: 'user', parts: userParts }];

    console.log("[SegmentImageTool] Calling Gemini API with advanced stylist prompt...");
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
        generationConfig: {
            responseMimeType: "application/json",
        },
        safetySettings,
        config: {
            systemInstruction: {
                role: "system",
                parts: [{ text: systemPrompt }]
            }
        }
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