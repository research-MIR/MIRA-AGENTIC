import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenAI, Content, Part, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64, decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

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
- **Your Output:** "For the man with short brown hair, fair skin, and a slight smile, change his red crew-neck t-shirt to a deep royal blue color. It is absolutely essential to preserve his exact identity, including his specific facial structure and skin tone. His standing pose must remain identical. The background, a bustling city street with yellow taxis and glass-front buildings, must be preserved in every detail, including the soft daytime lighting."`;

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

async function generatePrecisePrompt(ai: GoogleGenAI, userInstruction: string, allImageParts: Part[]): Promise<string> {
    const fallbackPrompt = `You are a virtual try-on AI assistant. Your task is to seamlessly edit the source image based on the user's instructions. Place the new garment over the existing clothing, preserving the model's identity, pose, and the background.`;
    try {
        const contents: Content[] = [{
            role: 'user',
            parts: [
                { text: `USER_INSTRUCTION: "${userInstruction}"` },
                ...allImageParts
            ]
        }];

        const response = await ai.models.generateContent({
            model: TEXT_MODEL_NAME,
            contents: contents,
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

    // Step 1: Prepare all image inputs first
    console.log("[EditWithWordsTool] Step 1: Preparing image inputs...");
    const [sourceImagePart, referenceImageParts] = await Promise.all([
        downloadImageAsPart(supabase, source_image_url, "SOURCE_IMAGE"),
        reference_image_urls && reference_image_urls.length > 0 
            ? Promise.all(reference_image_urls.map((url: string, i: number) => downloadImageAsPart(supabase, url, `REFERENCE_IMAGE ${i + 1}`)))
            : Promise.resolve([]),
    ]);
    const allImageParts = [...sourceImagePart, ...referenceImageParts.flat()];
    console.log("[EditWithWordsTool] Step 1 complete.");

    // Step 2: Generate the dynamic, precise prompt using the images as context
    console.log("[EditWithWordsTool] Step 2: Generating precise prompt...");
    const precisePrompt = await generatePrecisePrompt(ai, instruction, allImageParts);
    console.log("[EditWithWordsTool] Generated Precise Prompt:", precisePrompt);
    console.log("[EditWithWordsTool] Step 2 complete.");

    const textPart = { text: precisePrompt };
    const finalPartsForImageModel = [...allImageParts, textPart];

    // Step 3: Call the Gemini Image Editing API with the new prompt
    console.log(`[EditWithWordsTool] Step 3: Calling image model (${IMAGE_MODEL_NAME})...`);
    const response = await ai.models.generateContent({
        model: IMAGE_MODEL_NAME,
        contents: [{ parts: finalPartsForImageModel }],
    });
    console.log("[EditWithWordsTool] Step 3 complete. Received response from image model.");

    // Step 4: Handle the API response
    console.log("[EditWithWordsTool] Step 4: Handling API response...");
    if (response.promptFeedback?.blockReason) {
        console.error("[EditWithWordsTool] Prompt was blocked. Reason:", response.promptFeedback.blockReason);
        throw new Error(`Request was blocked by safety filters: ${response.promptFeedback.blockReason}`);
    }
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (!imagePartFromResponse?.inlineData) {
        const finishReason = response.candidates?.[0]?.finishReason;
        console.error("[EditWithWordsTool] No image data in response. Finish reason:", finishReason);
        throw new Error(`Image generation failed. Reason: ${finishReason || 'No image was returned.'}`);
    }
    console.log("[EditWithWordsTool] Step 4 complete. Found image data in response.");

    // Step 5: Upload to Storage and save job record
    console.log("[EditWithWordsTool] Step 5: Uploading to storage and saving job record...");
    const { mimeType, data: base64Data } = imagePartFromResponse.inlineData;
    const imageBuffer = decodeBase64(base64Data);
    const filePath = `${invoker_user_id}/edit-with-words/${Date.now()}_final.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: mimeType, upsert: true });
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    console.log(`[EditWithWordsTool] Image uploaded to: ${publicUrl}`);

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
    console.log("[EditWithWordsTool] Step 5 complete. Job record saved.");

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