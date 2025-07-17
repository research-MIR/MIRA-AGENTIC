import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest"; // Using the latest flash model for this visual task

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

const systemPrompt = `You are a "VTO Quality Assurance AI". You will be given a reference garment image, an original person image, and three generated "try-on" images labeled "Image 0", "Image 1", and "Image 2". Your sole task is to evaluate the three generated images and choose the single best one.

### Your Internal Thought Process (Chain-of-Thought)
Before providing your final JSON output, you MUST follow these steps internally to construct your 'reasoning' string:
1.  **Analyze REFERENCE Garment:** Briefly describe the key features of the reference garment (e.g., "a blue denim jacket with silver buttons").
2.  **Analyze Each Generated Image:** For each of the three generated images, perform a quick evaluation based on the core criteria.
    -   **Image 0:** How well does the garment match? How well is the pose preserved? Are there any major artifacts?
    -   **Image 1:** How well does the garment match? How well is the pose preserved? Are there any major artifacts?
    -   **Image 2:** How well does the garment match? How well is the pose preserved? Are there any major artifacts?
3.  **Make a Decision:** Compare your notes for the three images.
4.  **State Your Final Choice & Justification:** Clearly state which image you chose and why it is superior to the others based on the evaluation criteria. For example: "I chose Image 1 because the denim texture is the most realistic and the model's original pose is perfectly preserved, unlike Image 2 where the arm is distorted."

### Evaluation Criteria (in order of importance):
1.  **Garment Similarity (Highest Priority):** The garment on the model must be the most accurate reproduction of the reference garment. Check for color, texture, pattern, and details like logos or buttons.
2.  **Pose Preservation (Secondary Priority):** The model's pose in the generated image should be as close as possible to their pose in the original person image. The garment should look natural on the existing pose.
3.  **Image Quality & Artifacts (Tertiary Priority):** The image should be free of obvious AI artifacts, distortions, or unnatural blending.

### Your Output:
Your entire response MUST be a single, valid JSON object with TWO keys: "best_image_index" and "reasoning".

**Example Output:**
\`\`\`json
{
  "best_image_index": 1,
  "reasoning": "The reference is a blue denim jacket. Image 0 had an incorrect, darker color. Image 2 had a distorted left arm. Image 1 is the best choice because it accurately reproduces the color and texture of the denim jacket while perfectly preserving the model's original pose."
}
\`\`\``;

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
    const { 
        original_person_image_base64, 
        reference_garment_image_base64, 
        generated_images_base64 
    } = await req.json();

    if (!original_person_image_base64 || !reference_garment_image_base64 || !generated_images_base64 || !Array.isArray(generated_images_base64) || generated_images_base64.length === 0) {
      throw new Error("original_person_image_base64, reference_garment_image_base64, and a non-empty generated_images_base64 array are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const parts: Part[] = [
        { text: "--- ORIGINAL PERSON IMAGE ---" },
        { inlineData: { mimeType: 'image/png', data: original_person_image_base64 } },
        { text: "--- REFERENCE GARMENT IMAGE ---" },
        { inlineData: { mimeType: 'image/png', data: reference_garment_image_base64 } },
    ];

    generated_images_base64.forEach((base64, index) => {
        parts.push({ text: `--- GENERATED IMAGE ${index} ---` });
        parts.push({ inlineData: { mimeType: 'image/png', data: base64 } });
    });

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: "application/json" },
        safetySettings,
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const bestIndex = responseJson.best_image_index;

    if (typeof bestIndex !== 'number' || bestIndex < 0 || bestIndex >= generated_images_base64.length) {
        throw new Error("AI did not return a valid index for the best image.");
    }

    console.log("[VTO-QualityChecker] Full AI Response:", JSON.stringify(responseJson, null, 2));

    return new Response(JSON.stringify(responseJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-QualityChecker] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});