import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";

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

const systemPrompt = `You are a "VTO Quality Assurance AI". You will be given a reference garment image, an original person image, and a set of generated "try-on" images. Your sole task is to evaluate the generated images and decide on an action: 'select' the best one, or 'retry' if none are acceptable.

### Your Inputs:
- **is_final_attempt (boolean):** A flag indicating if this is the last chance to select an image.
- A series of images: REFERENCE GARMENT, ORIGINAL PERSON, and one or more GENERATED IMAGES. The generated images may come from different AI models or generation attempts.

### Your Internal Thought Process (Chain-of-Thought)
1.  **Analyze REFERENCE Garment:** Briefly describe its key features.
2.  **Analyze Each Generated Image:** Evaluate each image based on the core criteria. Note which images are superior, especially if they come from different generation attempts (e.g., a final, higher-quality attempt).
3.  **Make a Decision based on 'is_final_attempt':**
    -   **If 'is_final_attempt' is FALSE:** Be highly critical. If you find a high-quality image that meets all criteria, your action is 'select'. If ALL images have significant flaws (distorted anatomy, incorrect garment shape, severe artifacts), your action MUST be 'retry'.
    -   **If 'is_final_attempt' is TRUE:** You MUST select the single best option available from the entire set, even if it has minor flaws. Your action MUST be 'select'. Your reasoning should still explain why you chose it and what its flaws are, but you are not allowed to request another retry.
4.  **State Your Final Choice & Justification:** Clearly state your decision and why it is the best choice based on the evaluation criteria.

### Evaluation Criteria (in order of importance):
1.  **Garment Similarity (Highest Priority):** The garment on the model must be the most accurate reproduction of the reference garment.
2.  **Pose Preservation (Secondary Priority):** The model's pose should be as close as possible to their original pose.
3.  **Image Quality & Artifacts (Tertiary Priority):** The image should be free of obvious AI artifacts or distortions.

### Your Output:
Your entire response MUST be a single, valid JSON object with the following structure.

**If action is 'select':**
\`\`\`json
{
  "action": "select",
  "best_image_index": <number>,
  "reasoning": "A detailed explanation of why this image was chosen over the others."
}
\`\`\`

**If action is 'retry':**
\`\`\`json
{
  "action": "retry",
  "best_image_index": null,
  "reasoning": "A detailed explanation of why all images were rejected and a new attempt is needed."
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
    const { 
        original_person_image_base64, 
        reference_garment_image_base64, 
        generated_images_base64,
        is_final_attempt
    } = await req.json();

    if (!original_person_image_base64 || !reference_garment_image_base64 || !generated_images_base64 || !Array.isArray(generated_images_base64) || generated_images_base64.length === 0) {
      throw new Error("original_person_image_base64, reference_garment_image_base64, and a non-empty generated_images_base64 array are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const userPromptText = `This is the evaluation. is_final_attempt is ${is_final_attempt}. Please analyze the following images and provide your decision.`;
    const parts: Part[] = [
        { text: userPromptText },
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
    const { action, best_image_index, reasoning } = responseJson;

    if (!action || (action === 'select' && typeof best_image_index !== 'number') || !reasoning) {
        throw new Error("AI did not return a valid response with action, best_image_index (if applicable), and reasoning.");
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