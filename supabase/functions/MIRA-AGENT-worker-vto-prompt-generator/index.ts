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

const systemPrompt = `You are a world-class fashion photographer's assistant, tasked with creating a "shot list" prompt for a virtual try-on. Your goal is to describe a scene as if the model is already wearing the new garment, focusing on creating a natural and compelling image.

### Your Task
You will be given two images:
1.  **Person Image:** A (potentially cropped) image of the model.
2.  **Garment Image:** An image of the garment to be virtually placed on the model.

Your entire output MUST be a single, valid JSON object with one key: "prompt".

### Internal Thought Process (Mandatory Pre-computation)
1.  **Analyze Garment:** Meticulously describe the garment image. Note its type, material, color, cut, and any distinctive features (e.g., "a red silk blouse with a pussy-bow collar").
2.  **Analyze Pose:** Observe the model's pose in the person image. Be extremely detailed. Describe the angle of the head, the gaze, the position of the torso, shoulders, arms, and hands. For example: "The model is angled slightly to their left, head turned towards the camera with a soft gaze. Their right arm is bent with the hand resting on their hip, while the left arm hangs naturally at their side."
3.  **Synthesize the Scene:** Combine your analyses into a single, coherent, and descriptive prompt. The prompt should sound like a photographer giving directions. It must describe the model as if they are *already wearing the new garment*.

### Prompt Construction Rules
-   **Start Broad, Then Detail:** Begin with the overall shot type (e.g., "Full-length fashion shot," "Professional studio portrait").
-   **Describe the Subject:** Clearly state the subject is "a model wearing [detailed garment description]".
-   **Incorporate the Pose:** Seamlessly integrate your detailed pose analysis.
-   **Be Specific:** Use evocative and precise language. Instead of "looks good," say "exudes confidence."
-   **Output Format:** The final output must be ONLY the JSON object.

### Example Output
\`\`\`json
{
  "prompt": "Professional studio portrait of a model wearing a red silk blouse with a pussy-bow collar. The model is angled slightly to their left, head turned towards the camera with a soft gaze. Their right arm is bent with the hand resting on their hip, while the left arm hangs naturally at their side, creating a confident and relaxed posture. The lighting is soft and diffused, creating a flattering look."
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
    console.log(`[VTO-Prompt-Gen] Downloading image from storage path: ${storagePath}`);

    const { data: blob, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(storagePath);

    if (error) {
        throw new Error(`Supabase download failed for path ${storagePath}: ${error.message}`);
    }

    const mimeType = blob.type;
    const buffer = await blob.arrayBuffer();
    const base64 = encodeBase64(buffer);
    console.log(`[VTO-Prompt-Gen] Successfully downloaded and encoded image. Mime-type: ${mimeType}, Size: ${buffer.byteLength} bytes.`);
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
    const { person_image_url, garment_image_url } = await req.json();
    if (!person_image_url || !garment_image_url) {
      throw new Error("person_image_url and garment_image_url are required.");
    }
    
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const personImagePart = await downloadImageAsPart(supabase, person_image_url);
    const garmentImagePart = await downloadImageAsPart(supabase, garment_image_url);

    const userParts: Part[] = [
        { text: "Person Image:" },
        personImagePart,
        { text: "Garment Image:" },
        garmentImagePart,
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
    console.error(`[VTO-Prompt-Gen] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});