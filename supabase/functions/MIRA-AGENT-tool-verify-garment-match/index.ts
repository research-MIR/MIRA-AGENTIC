import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05"; // Upgraded Model
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

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

### Your Internal Thought Process (Chain-of-Thought)
Before providing your final JSON output, you MUST follow these steps internally:
1.  **Analyze REFERENCE Image:** Identify the key characteristics of the garment. What is its type (e.g., t-shirt, blazer), color, texture, and are there any logos or specific patterns?
2.  **Analyze FINAL RESULT Image:** Examine the garment worn by the model in the final result.
3.  **Compare Critically:** Perform a detailed comparison based on the following criteria:
    -   **Color Fidelity:** Is the hue, saturation, and brightness an exact match?
    -   **Shape & Fit:** Does the garment's cut, length (e.g., sleeves, hem), and overall shape match the reference?
    -   **Texture & Material:** Does the fabric look correct? (e.g., cotton vs. silk, denim vs. leather).
    -   **Material Finish:** Does the fabric have the correct sheen? (e.g., matte cotton, glossy satin, slight sheen on silk).
    -   **Patterns & Prints:** If a pattern exists, is it replicated accurately in terms of scale, color, and orientation? Is it distorted?
    -   **Hardware & Details:** Are zippers, buttons, stitching, and embroidery present and correctly rendered?
    -   **Logo Integrity:** If a logo is present in the reference, is it also present, clear, correctly spelled, and not distorted in the final result?
    -   **Overall Garment Integrity:** Check for common AI errors like the garment unnaturally blending into the model's skin, distorted seams, or disconnected parts.
4.  **Formulate Reason & Suggestion:** Based on your comparison, if there is a mismatch, formulate a concise technical reason and a helpful suggestion for improvement.
5.  **Construct Final JSON:** Finally, assemble your findings into the required JSON format.

### Your Response
Your response MUST be a single, valid JSON object with the following structure:
{
  "is_match": <boolean>,
  "confidence_score": <number between 0.0 and 1.0>,
  "logo_present": <boolean>,
  "logo_correct": <boolean | null>,
  "mismatch_reason": <string | null>,
  "fix_suggestion": <string | null>
}

- **is_match:** 'true' if the garment is a very close match, 'false' otherwise.
- **confidence_score:** Your confidence in the 'is_match' decision.
- **logo_present:** 'true' if a logo is visible on the garment in the FINAL RESULT image.
- **logo_correct:** If 'logo_present' is true, is the logo a correct replication of the reference? If 'logo_present' is false, this MUST be null.
- **mismatch_reason:** If 'is_match' is false, provide a concise, technical reason for the failure (e.g., "Color is oversaturated," "Sleeve length is incorrect," "Texture appears synthetic instead of cotton," "Logo is distorted."). If it's a match, this MUST be null.
- **fix_suggestion:** If 'is_match' is false, provide a single, actionable suggestion for the user to improve the result (e.g., "Try adding 'natural cotton texture' to the prompt appendix," "Attempt the generation again with a lower denoise strength to preserve the original shape better."). If it's a match, this MUST be null.
`;

function parseStorageURL(url: string) {
    const u = new URL(url);
    const pathSegments = u.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Invalid Supabase storage URL format: ${url}`);
    }
    const bucket = pathSegments[objectSegmentIndex + 2];
    const path = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    if (!bucket || !path) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${url}`);
    }
    return { bucket, path };
}

async function downloadAndEncodeImage(supabase: SupabaseClient, url: string): Promise<{ base64: string, mimeType: string }> {
    if (url.includes('supabase.co')) {
        const { bucket, path } = parseStorageURL(url);
        const { data: blob, error } = await supabase.storage.from(bucket).download(path);
        if (error) {
            throw new Error(`Failed to download image from Supabase storage (${path}): ${error.message}`);
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

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const contents: Content[] = [{
        role: 'user',
        parts: [
            { text: "REFERENCE:" },
            { inlineData: { mimeType: originalData.mimeType, data: originalData.base64 } },
            { text: "FINAL RESULT:" },
            { inlineData: { mimeType: finalData.mimeType, data: finalData.base64 } }
        ]
    }];

    let result: GenerationResult | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[VerifyGarmentMatch] Calling Gemini API, attempt ${attempt}...`);
            result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: contents,
                generationConfig: { responseMimeType: "application/json" },
                safetySettings,
                config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
            });
            lastError = null; // Clear error on success
            break; // Exit loop on success
        } catch (error) {
            lastError = error;
            console.warn(`[VerifyGarmentMatch] Attempt ${attempt} failed:`, error.message);
            if (attempt < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
            }
        }
    }

    if (lastError) {
        console.error(`[VerifyGarmentMatch] All retries failed. Last error:`, lastError.message);
        // Create a fallback error report
        const errorReport = {
            is_match: false,
            confidence_score: 0.0,
            logo_present: false,
            logo_correct: null,
            mismatch_reason: "The AI quality check failed to produce a valid analysis after multiple retries.",
            fix_suggestion: "This may be a temporary issue. You can try re-running the analysis manually from the report page.",
            error: `Analysis failed: ${lastError.message}`
        };
        return new Response(JSON.stringify(errorReport), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200, // Return 200 so the calling function can process the failure report
        });
    }

    if (!result) {
        throw new Error("AI model failed to respond after all retries.");
    }

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