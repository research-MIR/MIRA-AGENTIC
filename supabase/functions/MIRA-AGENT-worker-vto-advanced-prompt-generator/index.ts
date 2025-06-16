import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const BUCKET_NAME = 'mira-agent-user-uploads';

const systemPrompt = `You are a world-class fashion photographer's assistant, tasked with creating a "shot list" prompt for a virtual try-on. Your goal is to describe a scene as if the model is already wearing the new garment, focusing on creating a natural and compelling image. You must follow a complex set of rules based on the garments involved.

### Your Task
You will be given two images and optional user details:
1.  **Person Image:** A (potentially cropped) image of the model.
2.  **Garment Image:** An image of the garment to be virtually placed on the model.
3.  **Optional Details:** Extra text instructions from the user.

Your entire output MUST be a single, valid JSON object with one key: "prompt".

### Internal Thought Process (Mandatory Pre-computation)
1.  **Analyze Person's Outfit:** Look at the person image. Is the model wearing a one-piece outfit (like a dress) or a two-piece outfit (like a shirt and pants)?
2.  **Analyze New Garment:** Look at the garment image. Is it a one-piece, an upper-body item, or a lower-body item?
3.  **Synthesize Prompt based on Rules:**
    *   **RULE 1: Swapping a one-piece for another one-piece.** If the person is wearing a dress and the new garment is a dress, the prompt should simply be a detailed description of the model wearing the new dress.
    *   **RULE 2: Swapping a partial garment onto a one-piece.** If the person is wearing a dress and the new garment is a shirt, you MUST invent a plausible lower-body item. The prompt should be "A model wearing [detailed description of the new shirt] over a pair of dark wash denim jeans."
    *   **RULE 3: Swapping a garment onto a two-piece outfit.** If the person is wearing a shirt and pants, and the new garment is a jacket, the prompt must emphasize layering. For example: "A model wearing [the new jacket], which is clearly visible over their existing white t-shirt and jeans."
4.  **Incorporate Optional Details:** Weave the user's optional details (e.g., "make the shirt buttoned up," "add a black handbag") into the final synthesized prompt.
5.  **Describe Pose:** Meticulously describe the model's pose from the person image.
6.  **Combine Everything:** Create a single, coherent, and descriptive prompt that sounds like a photographer giving directions.

### Example Output
\`\`\`json
{
  "prompt": "Professional studio portrait of a model wearing a red silk blouse with a pussy-bow collar, worn over dark wash denim jeans. The model is angled slightly to their left, head turned towards the camera with a soft gaze. Their right arm is bent with the hand resting on their hip, while the left arm hangs naturally at their side, creating a confident and relaxed posture. The lighting is soft and diffused, creating a flattering look."
}
\`\`\`
`;

async function downloadImageAsPart(supabase: SupabaseClient, imageUrl: string): Promise<Part> {
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split(`/public/${BUCKET_NAME}/`);
    if (pathParts.length < 2) {
        throw new Error(`Could not parse storage path from URL: ${imageUrl}`);
    }
    const storagePath = decodeURIComponent(pathParts[1]);
    
    const { data: blob, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(storagePath);

    if (error) {
        throw new Error(`Supabase download failed for path ${storagePath}: ${error.message}`);
    }

    const mimeType = blob.type;
    const buffer = await blob.arrayBuffer();
    const base64 = encodeBase64(buffer);
    return { inlineData: { mimeType, data: base64 } };
}

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) { return JSON.parse(match[1]); }
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { person_image_url, garment_image_url, optional_details } = await req.json();
    if (!person_image_url || !garment_image_url) {
      throw new Error("person_image_url and garment_image_url are required.");
    }
    
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const userParts: Part[] = [
        { text: "Person Image:" },
        await downloadImageAsPart(supabase, person_image_url),
        { text: "Garment Image:" },
        await downloadImageAsPart(supabase, garment_image_url),
        { text: `Optional User Details: ${optional_details || 'None'}` }
    ];

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: {
            responseMimeType: "application/json",
        },
        config: {
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }
        }
    });

    const responseJson = extractJson(result.text);
    
    return new Response(JSON.stringify({ success: true, result: responseJson }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error(`[VTO-Advanced-Prompt-Gen] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});