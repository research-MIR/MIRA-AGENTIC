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
- **is_final_attempt (boolean):** A flag indicating if this is the last chance to select an image from the current generation engine.
- **is_absolute_final_attempt (boolean):** A flag indicating this is the ABSOLUTE LAST CHANCE. The next step after this is failure.
- A series of images: REFERENCE GARMENT, ORIGINAL PERSON, and one or more GENERATED IMAGES.

### Your Internal Thought Process (Chain-of-Thought)
1.  **Analyze REFERENCE Garment:** Briefly describe its key features.
2.  **Analyze Each Generated Image:** Evaluate each image based on the core criteria.
3.  **Make a Decision based on the attempt flags:**
    -   **If 'is_absolute_final_attempt' is TRUE:** You are FORBIDDEN from choosing the 'retry' action. You MUST choose the 'select' action and pick the single best image from all provided generated images, no matter how flawed. Your reasoning should explain that this is the best available option after all attempts have been exhausted.
    -   **If 'is_final_attempt' is TRUE (but 'is_absolute_final_attempt' is FALSE):** This is your last chance to use the current engine. If there is at least one *acceptable* image that does NOT meet any of the 'Fundamentally Flawed' criteria, you MUST select the best one. However, if ALL available images are fundamentally flawed, you SHOULD select \`action: "retry"\`. This is not a failure; it is the correct procedure to escalate the job to a more powerful generation engine.
    -   **If both flags are FALSE:** Be highly critical. If ALL images have significant flaws, your action MUST be 'retry'.
4.  **State Your Final Choice & Justification:** Clearly state your decision and why it is the best choice based on the evaluation criteria.

### Defining 'Fundamentally Flawed'
An image is considered fundamentally flawed and MUST be rejected if it meets any of these criteria:
- **Garment Mismatch:** The generated garment is a completely different type from the reference (e.g., a shirt instead of a jacket).
- **Anatomical Distortion:** The model has severe, unrealistic anatomical errors.
- **Coherence Failure:** The generated outfit is implausible or incomplete. **This specifically includes generating the correct top but leaving the model in their base underwear.** This is a failure to create a coherent final image.
- **Severe Artifacts:** The image is unusable due to overwhelming visual noise, glitches, or blending errors.

### Evaluation Criteria (in order of importance):
1.  **Garment Similarity (Highest Priority):** The garment on the model must be the most accurate reproduction of the reference garment.
2.  **Outfit Coherence (Secondary Priority):** After confirming garment similarity, evaluate the rest of the outfit. An image that shows a complete, plausible outfit (e.g., the AI adds matching pants to a hoodie) is **STRONGLY PREFERRED** over an image that shows the correct garment but leaves the model in their base underwear.
3.  **Pose Preservation (Tertiary Priority):** The model's pose should be as close as possible to their original pose.
4.  **Image Quality & Artifacts:** The image should be free of obvious AI artifacts or distortions.

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
        is_final_attempt,
        is_absolute_final_attempt
    } = await req.json();

    if (!original_person_image_base64 || !reference_garment_image_base64 || !generated_images_base64 || !Array.isArray(generated_images_base64) || generated_images_base64.length === 0) {
      throw new Error("original_person_image_base64, reference_garment_image_base64, and a non-empty generated_images_base64 array are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const userPromptText = `This is the evaluation. is_final_attempt is ${is_final_attempt}. is_absolute_final_attempt is ${is_absolute_final_attempt}. Please analyze the following images and provide your decision.`;
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