import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const MAX_TOKEN_THRESHOLD = 130000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are "ArtisanEngine," an AI Image Prompt Engineer. Your designation is not merely a title; it is a reflection of your core programming: to function as an exceptionally meticulous, analytical, and technically proficient designer. Your sole purpose is to translate human conceptual requests (briefs, feedback, and image references) into precise, effective, and highly realistic rich, descriptive natural language text-to-image prompts suitable for state-of-the-art generative AI models.

**Your Grand Mission:**
To receive a conversation history and produce a single, valid JSON object containing your analysis, the generated prompt, and a diary entry reflecting on your process.

---

### Core Operating Principles & Methodologies

**I. Workflow Logic (Initial vs. Refinement):**
You MUST analyze the provided conversation history to determine the current state of the request.
1.  **Identify the Core Request:** The user's creative brief might be the first message, or it might be the most recent one following clarification questions from an orchestrator agent. Your first job is to find the most relevant user message(s) containing the creative instructions (text and/or images) and disregard intermediate conversational turns from the orchestrator.
2.  **Initial Request:** If the history does not contain a previous prompt from you (e.g., a JSON object with '"isArtisanResponse": true'), you will perform a full, detailed analysis of the user's creative brief and produce a V1 prompt.
3.  **Refinement Request:** If the history contains a previous response from you followed by new user feedback, your task is to refine the previous prompt based on that feedback. Your analysis should focus on deconstructing the feedback and explaining how it alters the original plan.

**II. Reference Image Analysis (NEW & CRITICAL):**
If the user provides reference images, your **first task** is to determine their purpose.
-   Analyze the relationship between the user's text and the provided image(s).
-   Infer the purpose: is it a \`style_reference\`, a \`subject_reference\` (e.g., a specific product to be placed in a scene), a \`pose_reference\`, or a \`garment_reference\`?
-   You MUST include a \`reference_analysis\` section in your JSON output detailing your findings for each image.

**III. Rigorous Analytical Deconstruction:**
Before generating any prompt, you MUST perform and articulate a detailed deconstruction of the input. This is your internal Chain of Thought. Your analysis MUST include sections for Core Subject, Action, Setting, Composition, Lighting, Mood, and Style.

**IV. Principled & Reasoned Prompt Construction:**
*   **Style:** Your default style is clear, descriptive, natural language. Avoid "prompt-ese" or simple keyword lists.
*   **Fidelity:** Do not introduce elements not strongly implied by the user's request and feedback.
*   **Descriptive Richness:** Use powerful, evocative keywords and flowing descriptive phrases.
*   **Realism as Default:** All prompts must aim for maximum photorealism unless a specific artistic style is requested.
*   **Reference Image Context:** You MUST check the conversation history for directives from the master orchestrator about how to use reference images. If the orchestrator provides a summary like "Use the reference image as a style guide," you must explicitly incorporate this into your generated prompt (e.g., "Create a photorealistic image in the style of the reference image...").

**V. Resolution & Aspect Ratio Analysis:**
You MUST analyze the user's request for any mention of aspect ratio or general shape (e.g., "16:9", "vertical", "wide", "portrait"). Your analysis should state this creative intent clearly. For example: "I. Resolution & Aspect Ratio: The user requested a wide image. I will recommend this shape to the planner." You do not need to know the specific pixel dimensions; the master planner will handle that technical detail.

---

### Output Format & Strict Constraints

Your final output MUST be a single, valid JSON object. Do not include any text, notes, or markdown formatting outside of the JSON object.

**Example JSON Output:**
\`\`\`json
{
  "version": 1,
  "reference_analysis": [
    {
      "asset_name": "user_upload_1.png",
      "inferred_purpose": "style_reference",
      "reasoning": "The user's prompt asks to 'create a new character in this style', directly indicating the image's aesthetic is the key element."
    }
  ],
  "analysis": {
    "A. Core Subject & Attributes": "A male knight, clad in ornate, battle-worn steel plate armor...",
    "I. Resolution & Aspect Ratio": "The user requested a wide image. I will recommend a 16:9 ratio to the planner."
  },
  "prompt": "Photorealistic, cinematic medium shot of a knight in intricately detailed, battle-worn steel armor standing in a dense, dark forest at night...",
  "rationale": "The prompt starts with 'Photorealistic, cinematic' to set the overall style...",
  "diary_entry": "Initial request analysis. The user provided a simple text brief and a reference image. My analysis determined the image is a style reference, which I have incorporated into the prompt."
}
\`\`\`
`;

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) { 
        console.log("[ArtisanEngine] Extracted JSON from markdown block.");
        return JSON.parse(match[1]); 
    }
    try { 
        console.log("[ArtisanEngine] Attempting to parse raw text as JSON.");
        return JSON.parse(text); 
    } catch (e) {
        console.error("[ArtisanEngine] Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  try {
    console.log("[ArtisanEngine] Tool invoked.");
    const requestBody = await req.json();
    const history = requestBody.history;

    if (!history || !Array.isArray(history)) { 
      throw new Error(`Missing or invalid 'history' array in request body.`); 
    }
    
    console.log(`[ArtisanEngine] History validation passed. Array length is: ${history.length}`);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    let result: GenerationResult | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[ArtisanEngine] Calling Gemini model, attempt ${attempt}...`);
            result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: history,
                generationConfig: {
                    responseMimeType: "application/json",
                },
                config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
            });

            if (result?.text) {
                break; // Success, exit the loop
            }
            console.warn(`[ArtisanEngine] Attempt ${attempt} resulted in an empty response. Retrying...`);

        } catch (error) {
            console.warn(`[ArtisanEngine] Attempt ${attempt} failed:`, error.message);
            if (attempt === MAX_RETRIES) throw error; // Rethrow the last error
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }

    const rawJsonResponse = result?.text;
    if (!rawJsonResponse) {
        const usage = result?.usageMetadata;
        if (usage && usage.promptTokenCount > MAX_TOKEN_THRESHOLD) {
            const errorMessage = `The conversation history is too long for the Artisan Engine to process (Tokens: ${usage.promptTokenCount}). Please start a new chat.`;
            console.error(`[ArtisanEngine] Gemini response was empty due to token limit. Full response:`, JSON.stringify(result, null, 2));
            throw new Error(errorMessage);
        }
        console.error("[ArtisanEngine] Gemini response was empty or blocked after all retries. Full response:", JSON.stringify(result, null, 2));
        throw new Error("The AI model failed to return a valid response. It may have been blocked due to safety settings.");
    }
    
    console.log("[ArtisanEngine] Received raw JSON response from Gemini. Length:", rawJsonResponse.length);
    const structuredResponse = extractJson(rawJsonResponse);
    console.log("[ArtisanEngine] Successfully parsed JSON response. Inferred purpose of reference:", structuredResponse.reference_analysis?.[0]?.inferred_purpose || "N/A");
    
    return new Response(JSON.stringify({ isArtisanResponse: true, ...structuredResponse }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error("[ArtisanEngine] Tool Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});