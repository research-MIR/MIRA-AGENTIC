import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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

const systemPrompt = `You are a meticulous Quality Assurance AI for a fashion e-commerce platform. Your sole task is to compare two images: a "REFERENCE" image showing a clean shot of a garment, and a "FINAL RESULT" image showing that garment on a model.

You MUST determine if the garment in the FINAL RESULT is a faithful and high-quality replication of the one in the REFERENCE image.

Your response MUST be a single, valid JSON object with the following structure:
{
  "is_match": <boolean>,
  "confidence_score": <number between 0.0 and 1.0>,
  "mismatch_reason": <string | null>,
  "fix_suggestion": <string | null>
}

- is_match: 'true' if the garment is a very close match, 'false' otherwise.
- confidence_score: Your confidence in the 'is_match' decision.
- mismatch_reason: If 'is_match' is false, provide a concise, technical reason for the failure (e.g., "Color is oversaturated," "Sleeve length is incorrect," "Texture appears synthetic instead of cotton"). If it's a match, this MUST be null.
- fix_suggestion: If 'is_match' is false, provide a single, actionable suggestion for the user to improve the result (e.g., "Try adding 'natural cotton texture' to the prompt appendix," "Attempt the generation again with a lower denoise strength to preserve the original shape better."). If it's a match, this MUST be null.
`;

async function downloadAndEncodeImage(supabase: SupabaseClient, url: string): Promise<{ base64: string, mimeType: string }> {
    if (url.includes('supabase.co')) {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/');
        
        const publicSegmentIndex = pathSegments.indexOf('public');
        if (publicSegmentIndex === -1 || publicSegmentIndex + 1 >= pathSegments.length) {
            throw new Error(`Could not parse bucket name from Supabase URL: ${url}`);
        }
        
        const bucketName = pathSegments[publicSegmentIndex + 1];
        const filePath = pathSegments.slice(publicSegmentIndex + 2).join('/');

        if (!bucketName || !filePath) {
            throw new Error(`Could not parse bucket or path from Supabase URL: ${url}`);
        }

        const { data: blob, error } = await supabase.storage.from(bucketName).download(filePath);
        if (error) {
            throw new Error(`Failed to download image from Supabase storage (${filePath}): ${error.message}`);
        }
        const buffer = await blob.arrayBuffer();
        const base64 = encodeBase64(buffer);
        return { base64, mimeType: blob.type || 'image/png' };
    } else {
        // Handle external URLs (like BitStudio)
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download image from external URL ${url}. Status: ${response.statusText}`);
        }
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const base64 = encodeBase64(buffer);
        return { base64, mimeType: blob.type || 'image/png' };
    }
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
    const { original_garment_url, final_generated_url } = await req.json();
    if (!original_garment_url || !final_generated_url) {
      throw new Error("original_garment_url and final_generated_url are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const [originalData, finalData] = await Promise.all([
        downloadAndEncodeImage(supabase, original_garment_url),
        downloadAndEncodeImage(supabase, final_generated_url)
    ]);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const contents: Content[] = [{
        role: 'user',
        parts: [
            { text: "REFERENCE:" },
            { inlineData: { mimeType: originalData.mimeType, data: originalData.base64 } },
            { text: "FINAL RESULT:" },
            { inlineData: { mimeType: finalData.mimeType, data: finalData.base64 } }
        ]
    }];

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
        generationConfig: { responseMimeType: "application/json" },
        safetySettings,
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);

    return new Response(JSON.stringify(responseJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VerifyGarmentMatch] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});