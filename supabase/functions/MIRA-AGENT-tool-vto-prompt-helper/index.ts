import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert fashion stylist and photo analyst. Your task is to combine two images into a single, coherent, and detailed text-to-image prompt. The final prompt MUST be in English.

### Your Inputs:
You will be given two images:
1.  **PERSON IMAGE:** This image contains the model, their pose, the background scene, and the overall lighting and mood.
2.  **GARMENT IMAGE:** This image contains a piece of clothing.

### Your Internal Thought Process (Do not include this in the output):
1.  **Analyze the PERSON IMAGE:** Deconstruct the scene. Describe the model's pose, the lighting style (e.g., "soft studio lighting," "harsh outdoor sunlight"), the background details, and the overall mood or aesthetic.
2.  **Analyze the GARMENT IMAGE:** Describe the garment with extreme detail. Mention its type (e.g., "denim jacket," "silk blouse"), color, fabric texture, fit, and any notable details like buttons, zippers, patterns, or stitching.
3.  **Synthesize:** Create a new, single prompt that describes the person from the PERSON IMAGE as if they are now wearing the clothing from the GARMENT IMAGE. The final prompt should seamlessly integrate the detailed garment description onto the person within their original environment and lighting.

### Your Output:
Your entire response MUST be a single, valid JSON object with ONE key, "final_prompt".

**Example Output:**
\`\`\`json
{
  "final_prompt": "A photorealistic, cinematic shot of a woman standing with her hands on her hips in a dimly lit urban alleyway. She is wearing a vintage, slightly oversized, faded blue denim jacket with worn-out elbows and brass buttons. The lighting is dramatic, with a single light source from the side creating long shadows."
}
\`\`\`
`;

async function downloadImageAsPart(publicUrl: string, label: string): Promise<Part[]> {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error("Supabase URL or Service Role Key are not set in environment variables.");
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const url = new URL(publicUrl);
    const filePath = url.pathname.split(`/${UPLOAD_BUCKET}/`)[1];
    if (!filePath) throw new Error(`Could not parse file path from URL: ${publicUrl}`);

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath);
    if (downloadError) throw new Error(`Supabase download failed for ${label}: ${downloadError.message}`);

    const mimeType = fileBlob.type;
    const buffer = await fileBlob.arrayBuffer();
    const base64 = encodeBase64(buffer);

    return [
        { text: `--- ${label} ---` },
        { inlineData: { mimeType, data: base64 } }
    ];
}

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        return JSON.parse(match[1]);
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { person_image_url, garment_image_url } = await req.json();
    if (!person_image_url || !garment_image_url) {
      throw new Error("person_image_url and garment_image_url are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const [personParts, garmentParts] = await Promise.all([
        downloadImageAsPart(person_image_url, "PERSON IMAGE"),
        downloadImageAsPart(garment_image_url, "GARMENT IMAGE")
    ]);

    const finalParts: Part[] = [...personParts, ...garmentParts];

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: finalParts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const finalPrompt = responseJson.final_prompt;

    if (!finalPrompt) {
        throw new Error("AI Helper did not return a final prompt in the expected format.");
    }

    return new Response(JSON.stringify({ final_prompt: finalPrompt }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-PromptHelper] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});