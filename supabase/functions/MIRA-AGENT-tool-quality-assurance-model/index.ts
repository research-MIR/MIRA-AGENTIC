import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Quality Assurance AI" for a photorealistic model generation pipeline. You will be given a user's creative brief and four images of the same human model, labeled "Image 0", "Image 1", "Image 2", and "Image 3". Your sole task is to evaluate them and choose the single best one that matches the brief.

### Evaluation Criteria (in order of importance):
1.  **Prompt Coherence:** This is the most important factor. Does the model in the image accurately reflect the user's 'Model Description'? (e.g., if the user asked for "long blonde hair," does the model have it?).
2.  **Anatomical Correctness:** The model must have realistic human anatomy. Check for common AI errors like incorrect hands, distorted limbs, or unnatural facial features. Reject any image with clear anatomical flaws.
3.  **Photorealism:** The image should look like a real photograph. Assess the skin texture, lighting, and overall quality.
4.  **Aesthetic Appeal:** The model's pose and expression should be neutral, professional, and suitable for an e-commerce catalog.

### Your Input:
You will receive the user's descriptions and the images to evaluate.

### Your Output:
Your entire response MUST be a single, valid JSON object with ONE key, "best_image_index". The value must be the integer index (0, 1, 2, or 3) of the image you have selected.

**Example Output:**
\`\`\`json
{
  "best_image_index": 2
}
\`\`\`
`;

async function downloadImageAsPart(publicUrl: string, label: string): Promise<Part[]> {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(bucketName).download(filePath);
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
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { image_urls, model_description, set_description } = await req.json();
    if (!image_urls || !Array.isArray(image_urls) || image_urls.length === 0) {
      throw new Error("image_urls array is required.");
    }
    if (!model_description) {
      throw new Error("model_description is required for coherence check.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    
    const userBriefText = `--- USER'S CREATIVE BRIEF ---\nModel Description: "${model_description}"\nSet Description: "${set_description || 'a minimal studio with a neutral background'}"\n--- END BRIEF ---`;
    const parts: Part[] = [{ text: userBriefText }];

    const imagePartsPromises = image_urls.map((url, index) => downloadImageAsPart(url, `Image ${index}`));
    const imagePartsArrays = await Promise.all(imagePartsPromises);
    parts.push(...imagePartsArrays.flat());

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    const bestIndex = responseJson.best_image_index;

    if (typeof bestIndex !== 'number' || bestIndex < 0 || bestIndex >= image_urls.length) {
        throw new Error("AI did not return a valid index for the best image.");
    }

    return new Response(JSON.stringify({ best_image_index: bestIndex }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[QualityAssuranceTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});