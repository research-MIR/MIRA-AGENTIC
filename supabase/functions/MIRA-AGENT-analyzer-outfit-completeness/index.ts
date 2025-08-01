import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flashgemini-2.5-flash-lite";
const MAX_RETRIES = 9;
const RETRY_DELAY_MS = 45000;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE
  }
];
const systemPrompt = `You are a meticulous fashion stylist AI. Your task is to analyze the provided image to determine if the model is wearing a "complete outfit," based on the context of the garment that was just virtually applied.

### Your Inputs:
- **Image to Analyze:** The image of the model after the virtual try-on.
- **VTO Garment Type:** A string indicating the type of garment that was just added ('upper body', 'lower body', or 'full body').

### Your Logic & Rules:
1.  **Full Body Check:** If \`vto_garment_type\` is 'full body' (e.g., a dress, jumpsuit), the outfit is considered complete by default, unless the model is barefoot in a non-beach/indoor casual setting.
2.  **Upper Body Check:** If \`vto_garment_type\` is 'upper body' (e.g., a shirt, jacket), you MUST check if the model is wearing a corresponding lower body garment (pants, skirt, shorts, etc.). The outfit is incomplete if they are still in their base underwear or are topless on the bottom half.
3.  **Lower Body Check:** If \`vto_garment_type\` is 'lower body' (e.g., pants, skirt), you MUST check if the model is wearing a corresponding upper body garment (shirt, blouse, etc.). The outfit is incomplete if they are topless or only wearing a base bra.
4.  **Footwear Check (CRITICAL):** You MUST check if the model is wearing shoes. The ONLY exception is if the scene is clearly a beach, poolside, or an indoor, casual setting like a bedroom. In a studio or outdoor urban/natural setting, the absence of shoes makes the outfit incomplete - clearly if i s wearing ANY kind of footwear is not missing - it has to be barefoot to have this missing
5.  **Identify Missing Items:** If the outfit is incomplete, create a list of the missing item categories. The possible values for this list are: "upper_body", "lower_body", "shoes". - a bra or underwear do not consitute lower or upper body coverage, do not consider them as such

### Your Output:
Your entire response MUST be a single, valid JSON object. Do not include any other text or explanations.

**Example Output 1 (Incomplete):**
\`\`\`json
{
  "is_outfit_complete": false,
  "missing_items": ["lower_body", "shoes"],
  "reasoning": "The model is wearing the generated top but appears to be in their base underwear and is barefoot in what looks like a studio setting."
}
\`\`\`

**Example Output 2 (Incomplete):**
\`\`\`json
{
  "is_outfit_complete": false,
  "missing_items": ["lower_body"],
  "reasoning": "The model is wearing the generated top but appears to be in their base underwear in what looks like a studio setting."
}
\`\`\`

**Example Output 3 (Complete):**
\`\`\`json
{
  "is_outfit_complete": true,
  "missing_items": [],
  "reasoning": "The model is wearing the generated pants, a plausible t-shirt, and sneakers, forming a complete casual outfit."
}
\`\`\`
`;
function extractJson(text: string): any {
    if (!text) { // Guard clause for null, undefined, or empty string
        throw new Error("The model returned an empty response.");
    }
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        try {
            return JSON.parse(match[1]);
        } catch (e) {
            console.error("Failed to parse extracted JSON block:", e);
            throw new Error("The model returned a malformed JSON block.");
        }
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse raw text as JSON:", e);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { image_to_analyze_base64, vto_garment_type } = await req.json();
    if (!image_to_analyze_base64 || !vto_garment_type) {
      throw new Error("image_to_analyze_base64 and vto_garment_type are required.");
    }
    const ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY
    });
    const userPromptText = `VTO Garment Type: "${vto_garment_type}"`;
    const parts = [
      {
        text: userPromptText
      },
      {
        inlineData: {
          mimeType: 'image/png',
          data: image_to_analyze_base64
        }
      }
    ];
    let result = null;
    let lastError = null;
    for(let attempt = 1; attempt <= MAX_RETRIES; attempt++){
      try {
        console.log(`[OutfitCompletenessAnalyzer] Calling Gemini API, attempt ${attempt}...`);
        result = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [
            {
              role: 'user',
              parts
            }
          ],
          generationConfig: {
            responseMimeType: "application/json"
          },
          safetySettings,
          config: {
            systemInstruction: {
              role: "system",
              parts: [
                {
                  text: systemPrompt
                }
              ]
            }
          }
        });
        lastError = null; // Clear error on success
        break; // Exit loop on success
      } catch (error) {
        lastError = error;
        console.warn(`[OutfitCompletenessAnalyzer] Attempt ${attempt} failed:`, error.message);
        if (error.message.includes("503") && attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * attempt; // Exponential backoff
          console.log(`[OutfitCompletenessAnalyzer] Model is overloaded. Retrying in ${delay}ms...`);
          await new Promise((resolve)=>setTimeout(resolve, delay));
        } else {
          break;
        }
      }
    }
    if (lastError) {
      console.error(`[OutfitCompletenessAnalyzer] All retries failed. Last error:`, lastError.message);
      throw lastError;
    }
    if (!result) {
      throw new Error("AI model failed to respond after all retries.");
    }
    const analysisResult = extractJson(result.text);
    return new Response(JSON.stringify(analysisResult), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error("[OutfitCompletenessAnalyzer] Error:", error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});