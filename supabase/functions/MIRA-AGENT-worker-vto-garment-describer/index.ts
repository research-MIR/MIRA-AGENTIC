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
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const BUCKET_NAME = 'mira-agent-user-uploads';

const systemPrompt = `You are an expert fashion cataloger. Your only task is to describe the provided garment image in a single, detailed sentence. Focus on type, material, color, and cut. Output only a JSON object with a 'prompt' key.

Example Input: [Image of a red silk blouse]
Example Output:
\`\`\`json
{
  "prompt": "A red silk blouse with a pussy-bow collar."
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
    const { garment_image_url } = await req.json();
    if (!garment_image_url) {
      throw new Error("garment_image_url is required.");
    }
    
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const garmentImagePart = await downloadImageAsPart(supabase, garment_image_url);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [garmentImagePart] }],
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
    console.error(`[VTO-Garment-Describer] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});