import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI, Content, Part, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64, decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

const TEXT_MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const IMAGE_MODEL_NAME = "gemini-2.5-flash-image-preview-05-27";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const metaPrompt = `You are an expert prompt engineer for a generative AI model that performs image editing.
Your task is to generate a precise, safe, and effective prompt for an image generation model ('gemini-2.5-flash-image-preview').
You will be given a user's instruction and context about the images involved.
Your final prompt must be a single, natural language instruction.
It is critical to use safe and unambiguous language. For example, instead of saying "remove the original clothing", instruct the model to "place the new garment over the existing clothing" or "cover the original clothing". Avoid any phrasing that could be misinterpreted by safety filters.
The output should be ONLY the text of the generated prompt for the image model. Do not include any other text, greetings, or explanations.`;

async function downloadImageAsPart(supabase: SupabaseClient, url: string, label: string): Promise<Part[]> {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Could not parse bucket name from Supabase URL: ${url}`);
    }
    const bucketName = pathSegments[objectSegmentIndex + 2];
    const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(bucketName).download(filePath);
    if (downloadError) throw new Error(`Supabase download failed: ${downloadError.message}`);

    const mimeType = fileBlob.type;
    const buffer = await fileBlob.arrayBuffer();
    const base64 = encodeBase64(buffer);

    return [
        { text: `--- ${label} ---` },
        { inlineData: { mimeType, data: base64 } }
    ];
}

async function generatePrecisePrompt(ai: GoogleGenAI, userInstruction: string, hasReference: boolean): Promise<string> {
    const fallbackPrompt = `You are a virtual try-on AI assistant. Your task is to seamlessly edit the source image based on the user's instructions. Place the new garment over the existing clothing, preserving the model's identity, pose, and the background.`;
    try {
        const context = `The user wants to edit an image. Their instruction is: "${userInstruction}". ${hasReference ? 'They have also provided a reference image to guide the style or object.' : ''}`;
        const response = await ai.models.generateContent({
            model: TEXT_MODEL_NAME,
            contents: [{ role: 'user', parts: [{ text: context }] }],
            config: { systemInstruction: { role: "system", parts: [{ text: metaPrompt }] } }
        });
        const precisePrompt = response.text?.trim();
        if (!precisePrompt) {
            console.warn("Precise prompt generation resulted in an empty response. Using fallback.");
            return fallbackPrompt;
        }
        return precisePrompt;
    } catch (err) {
        console.error("Failed to generate the precise prompt, using fallback.", err);
        return fallbackPrompt;
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { source_image_url, instruction, reference_image_urls, invoker_user_id } = await req.json();
    if (!source_image_url || !instruction || !invoker_user_id) {
      throw new Error("source_image_url, instruction, and invoker_user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    // Step 1 & 2: Prepare inputs and generate a precise prompt concurrently
    const [sourceImagePart, referenceImageParts, precisePrompt] = await Promise.all([
        downloadImageAsPart(supabase, source_image_url, "SOURCE IMAGE"),
        reference_image_urls && reference_image_urls.length > 0 
            ? Promise.all(reference_image_urls.map((url: string, i: number) => downloadImageAsPart(supabase, url, `REFERENCE IMAGE ${i + 1}`)))
            : Promise.resolve([]),
        generatePrecisePrompt(ai, instruction, !!reference_image_urls && reference_image_urls.length > 0)
    ]);

    const textPart = { text: precisePrompt };
    const finalParts = [...sourceImagePart, ...referenceImageParts.flat(), textPart];

    // Step 3: Call the Gemini Image Editing API
    const response = await ai.models.generateContent({
        model: IMAGE_MODEL_NAME,
        contents: [{ parts: finalParts }],
    });

    // Step 4: Handle the API response
    if (response.promptFeedback?.blockReason) {
        throw new Error(`Request was blocked by safety filters: ${response.promptFeedback.blockReason}`);
    }
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (!imagePartFromResponse?.inlineData) {
        const finishReason = response.candidates?.[0]?.finishReason;
        throw new Error(`Image generation failed. Reason: ${finishReason || 'No image was returned.'}`);
    }

    // Step 5: Upload to Storage and save job record
    const { mimeType, data: base64Data } = imagePartFromResponse.inlineData;
    const imageBuffer = decodeBase64(base64Data);
    const filePath = `${invoker_user_id}/edit-with-words/${Date.now()}_final.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: mimeType, upsert: true });
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

    await supabase.from('mira-agent-comfyui-jobs').insert({
        user_id: invoker_user_id,
        status: 'complete',
        final_result: { publicUrl },
        metadata: {
            source: 'edit-with-words',
            prompt: precisePrompt,
            source_image_url,
            reference_image_urls,
        }
    });

    return new Response(JSON.stringify({ success: true, finalImageUrl: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EditWithWordsTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});