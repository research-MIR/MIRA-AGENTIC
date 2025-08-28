import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI, Content, Part, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

const TEXT_MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const IMAGE_MODEL_NAME = "gemini-2.5-flash-image-preview";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const metaPrompt = `You are a "Hyper-Detailed Image Editor's Assistant". Your task is to analyze a user's request and the provided images, then generate a single, precise, and safe prompt for a powerful image editing model.

### Your Inputs:
- **USER_INSTRUCTION:** A text instruction from the user.
- **SOURCE_IMAGE:** The base image to be edited.
- **REFERENCE_IMAGE (Optional):** An image providing style or content guidance.

### Your Internal Thought Process:
1.  **Deconstruct the User's Goal:** Analyze the USER_INSTRUCTION to understand the primary editing task (e.g., change clothing, alter background, add an object).
2.  **Analyze the Source Image for Preservation:** This is your most critical task. Visually inspect the SOURCE_IMAGE and create a detailed mental description of everything that should NOT change. This includes:
    -   **Identity:** The person's specific facial features, skin tone, hair style and color.
    -   **Pose:** The exact position of their body, limbs, and head.
    -   **Background:** The specific elements and style of the environment.
    -   **Lighting:** The direction, quality (soft/hard), and color of the light.
3.  **Synthesize the Final Prompt:** Construct a single, natural-language paragraph for the image model. This prompt MUST combine:
    -   A clear instruction for the change requested by the user.
    -   **Explicit, detailed instructions to preserve all other elements**, using the descriptions you generated in step 2.

### Critical Rules:
- **Preserve by Default:** Your prompt must be heavily weighted towards preservation. Describe what to keep in more detail than what to change.
- **Safety First:** Use unambiguous language. Instead of "remove clothing," say "place the new garment over the existing clothing."
- **Describe, Don't Point:** If a reference image is used, describe its key attributes in the prompt. Do not say "make it look like the reference image."
- **Output:** Your entire response must be ONLY the final text prompt.

### Example:
- **USER_INSTRUCTION:** "change his t-shirt to blue"
- **SOURCE_IMAGE:** [Image of a man with brown hair in a red shirt, standing on a city street]
- **Your Output:** "For the man with short brown hair, fair skin, and a slight smile, change his red crew-neck t-shirt to a deep royal blue color. It is absolutely critical to preserve his exact identity, including his specific facial structure and skin tone. His standing pose must remain identical. The background, a bustling city street with yellow taxis and glass-front buildings, must be preserved in every detail, including the soft daytime lighting."`;

async function maybeDownscaleBlob(blob: Blob, maxSide = 2048, jpegQuality = 85): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const img = await Image.decode(bytes);
  const maxDim = Math.max(img.width, img.height);
  if (maxDim <= maxSide) return blob;

  const scale = maxSide / maxDim;
  img.resize(Math.round(img.width * scale), Math.round(img.height * scale), Image.RESIZE_LANCZOS);
  const jpeg = await img.encodeJPEG(jpegQuality);
  return new Blob([jpeg], { type: "image/jpeg" });
}

async function uploadGeminiFileFromSupabaseURL(
  supabase: SupabaseClient,
  ai: GoogleGenAI,
  url: string,
  displayName: string,
  opts: { maxSide?: number; jpegQuality?: number } = {}
) {
  const { maxSide = 2048, jpegQuality = 85 } = opts;

  const u = new URL(url);
  const seg = u.pathname.split('/');
  const i = seg.indexOf('object');
  if (i === -1 || i + 2 >= seg.length) throw new Error(`Bad Supabase URL: ${url}`);
  const bucket = seg[i + 2];
  const filePath = decodeURIComponent(seg.slice(i + 3).join('/'));

  const { data: blob, error } = await supabase.storage.from(bucket).download(filePath);
  if (error) throw new Error(`Supabase download failed: ${error.message}`);

  const prepped = await maybeDownscaleBlob(blob, maxSide, jpegQuality);

  const file = await ai.files.upload({
    file: prepped,
    config: { mimeType: prepped.type, displayName }
  });

  return file;
}

async function generatePrecisePrompt(ai: GoogleGenAI, userInstruction: string, files: any[]): Promise<string> {
    const fallbackPrompt = `You are a virtual try-on AI assistant. Your task is to seamlessly edit the source image based on the user's instructions. Place the new garment over the existing clothing, preserving the model's identity, pose, and the background.`;
    try {
        const contents: any[] = [
            ...files,
            { text: `USER_INSTRUCTION: "${userInstruction}"` }
        ];

        const response = await ai.models.generateContent({
            model: TEXT_MODEL_NAME,
            contents: [{ role: 'user', parts: contents }],
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

  const { job_id } = await req.json();
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[EditWithWordsWorker][${job_id}]`;

  try {
    console.log(`${logPrefix} Starting job.`);
    await supabase.from('mira-agent-comfyui-jobs').update({ status: 'processing' }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('metadata, user_id')
      .eq('id', job_id)
      .single();
    
    if (fetchError) throw fetchError;

    const { source_image_url, instruction, reference_image_urls } = job.metadata;
    const invoker_user_id = job.user_id;

    if (!source_image_url || !instruction || !invoker_user_id) {
      throw new Error("Job metadata is missing required fields: source_image_url, instruction, or user_id.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    console.log(`${logPrefix} Step 1: Preparing and uploading image inputs sequentially...`);
    const sourceFile = await uploadGeminiFileFromSupabaseURL(supabase, ai, source_image_url, "SOURCE_IMAGE");
    
    const MAX_REFS = 4;
    const refsToUpload = (reference_image_urls || []).slice(0, MAX_REFS);
    const referenceFiles: any[] = [];
    for (let i = 0; i < refsToUpload.length; i++) {
        const file = await uploadGeminiFileFromSupabaseURL(supabase, ai, refsToUpload[i], `REFERENCE_IMAGE_${i + 1}`);
        referenceFiles.push(file);
    }
    console.log(`${logPrefix} Step 1 complete. Uploaded ${1 + referenceFiles.length} file(s) to Gemini.`);

    console.log(`${logPrefix} Step 2: Generating precise prompt...`);
    const precisePrompt = await generatePrecisePrompt(ai, instruction, [sourceFile, ...referenceFiles]);
    console.log(`${logPrefix} Generated Precise Prompt:`, precisePrompt);
    console.log(`${logPrefix} Step 2 complete.`);

    const finalPartsForImageModel: any[] = [sourceFile, ...referenceFiles, { text: precisePrompt }];

    console.log(`${logPrefix} Step 3: Calling image model (${IMAGE_MODEL_NAME})...`);
    const response = await ai.models.generateContent({
        model: IMAGE_MODEL_NAME,
        contents: [{ parts: finalPartsForImageModel }],
    });
    console.log(`${logPrefix} Step 3 complete. Received response from image model.`);

    console.log(`${logPrefix} Step 4: Handling API response...`);
    if (response.promptFeedback?.blockReason) {
        throw new Error(`Request was blocked by safety filters: ${response.promptFeedback.blockReason}`);
    }
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (!imagePartFromResponse?.inlineData) {
        const finishReason = response.candidates?.[0]?.finishReason;
        throw new Error(`Image generation failed. Reason: ${finishReason || 'No image was returned.'}`);
    }
    console.log(`${logPrefix} Step 4 complete. Found image data in response.`);

    console.log(`${logPrefix} Step 5: Uploading to storage and saving job record...`);
    const { mimeType, data: base64Data } = imagePartFromResponse.inlineData;
    const imageBuffer = decodeBase64(base64Data);
    const filePath = `${invoker_user_id}/edit-with-words/${Date.now()}_final.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: mimeType, upsert: true });
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    console.log(`${logPrefix} Image uploaded to: ${publicUrl}`);

    await supabase.from('mira-agent-comfyui-jobs').update({
        status: 'complete',
        final_result: { publicUrl },
        metadata: {
            ...job.metadata,
            prompt: precisePrompt,
        }
    }).eq('id', job_id);
    console.log(`${logPrefix} Step 5 complete. Job record saved.`);

    return new Response(JSON.stringify({ success: true, finalImageUrl: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-comfyui-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});