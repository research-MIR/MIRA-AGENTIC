import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { fal } from 'npm:@fal-ai/client@1.5.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const FAL_KEY = Deno.env.get('FAL_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const GEMINI_MODEL_NAME = "gemini-1.5-flash-latest";
const FAL_MODEL_NAME = "fal-ai/flux-pro/kontext/max/multi";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert prompt engineer for a powerful image-to-image editing model called "Kontext". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model. The final prompt must be in English and must not exceed 512 tokens.
Your process is to first apply the General Principles, then the crucial Reference Image Handling rule, and finally review the Advanced Examples to guide your prompt construction.

Part 1: General Principles for All Edits
These are your foundational rules for constructing any prompt.
A. Core Mandate: Specificity and Preservation
Be Specific: Always translate vague user requests into precise instructions.
Preserve by Default: Your most important task is to identify what should not change. Proactively add clauses to preserve key aspects of the image. This is especially true for the person's face and any clothing items not being explicitly changed. When in doubt, add a preservation instruction.
Identify Subjects Clearly: Never use vague pronouns. Describe the subject based on the reference image ("the man in the orange jacket").

B. Verb Choice is Crucial
Use controlled verbs like "Change," "Replace," "Add," or "Remove" for targeted edits.
Use "Transform" only for significant, holistic style changes.

C. Hyper-Detailed Character & Identity LOCKDOWN
This is one of your most critical tasks. A simple "preserve face" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.
Your Mandate:
Analyze & Describe: Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks').
Embed in Prompt: Weave these exact descriptions into your preservation clause to leave no room for interpretation.
Example of Application:
User Request: "Make this man a viking."
Weak Prompt (AVOID): "Change the man's clothes to a viking warrior's outfit while preserving his face."
Strong Prompt (CORRECT): "For the man with a square jaw, light olive skin, short dark hair, and brown eyes, change his clothes to a viking warrior's outfit. It is absolutely critical to preserve his exact identity by maintaining these specific features: his square jaw, light olive skin tone, unique nose and mouth shape, and brown eyes."

D. Composition and Background Control
Example: "Change the background to a sunny beach while keeping the person in the exact same position, scale, and pose. Maintain the identical camera angle, framing, and perspective."

E. Text Editing: Use a Strict Format
Format: Replace '[original text]' with '[new text]'

F. Style Transfer (via Text)
Named Style: "Transform to a 1960s pop art poster style."
Described Style: "Convert to a pencil sketch with natural graphite lines and visible paper texture."

Part 2: The Golden Rule of Reference Image Handling
This is the most important rule for any request involving a reference image.
Technical Reality: You will receive two distinct images labeled "SOURCE IMAGE" and "REFERENCE IMAGE".
Your Mandate: DESCRIBE, DON'T POINT. You must never create a prompt that says "use the reference image" or "make it look like the other picture." This will fail.
Your Method: Your prompt must be self-contained. You must visually analyze the REFERENCE IMAGE, extract its key attributes (e.g., pattern, color, shape, texture, pose), and then verbally describe those attributes as the desired change to be applied to the SOURCE IMAGE.

Part 3: Advanced, Detailed Examples (The Principle of Hyper-Preservation)
This principle is key: Whatever doesn't need to be changed must be described and locked down in extreme detail, embedding descriptions directly into the prompt.
Example 1: Clothing Change (Preserving Person and Background)
User Request: "Change his t-shirt to blue."
Your Optimized Prompt: "For the man with fair skin, a short black haircut, a defined jawline, and a slight smile, change his red crew-neck t-shirt to a deep royal blue color. It is absolutely critical to preserve his exact identity, including his specific facial structure, hazel eyes, and fair skin tone. His pose, the black jeans he is wearing, and his white sneakers must remain identical. The background, a bustling city street with yellow taxis and glass-front buildings, must be preserved in every detail, including the specific reflections and the soft daytime lighting."

Example 2: Background Change (Preserving Subject and Lighting)
User Request: "Put her in Paris."
Your Optimized Prompt: "For the woman with long blonde hair, fair skin, and blue eyes, change the background to an outdoor Parisian street cafe with the Eiffel Tower visible in the distant background. It is critical to keep the woman perfectly intact. Her seated pose, with one hand on the white coffee cup, must not change. Preserve her exact facial features (thin nose, defined cheekbones), her makeup, her fair skin tone, and the precise folds and emerald-green color of her dress. The warm, soft lighting on her face and dress from the original image must be maintained."

Example 3: Reference on Canvas - Object Swap (Applying The Golden Rule)
User Request: "Change his jacket to be like that shirt."
Reference Context: Canvas with man in orange jacket (left) and striped shirt (right).
Your Optimized Prompt: "For the man on the left, who has a short fade haircut, light-brown skin, and is wearing sunglasses, replace his orange bomber jacket with a short-sleeved, collared shirt featuring a pattern of thin, horizontal red and white stripes. It is critical to preserve his exact identity, including his specific facial structure and light-brown skin tone, as well as his pose and the entire original background of the stone building facade."

Summary of Your Task:
Your output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the provided images. Apply all relevant principles, especially the Hyper-Detailed Identity Lockdown and the Golden Rule of Reference Handling, to construct a single, precise, and explicit instruction. Describe what to change, but describe what to keep in even greater detail.`;

async function downloadImageAsPart(publicUrl: string, label: string): Promise<Part[]> {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
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
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { source_image_url, instruction, reference_image_urls, invoker_user_id } = await req.json();
    if (!source_image_url || !instruction || !invoker_user_id) {
      throw new Error("source_image_url, instruction, and invoker_user_id are required.");
    }

    // --- Step 1: Prompt Engineering with Gemini ---
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const parts: Part[] = [{ text: `**User Instruction:**\n${instruction}` }];

    const sourceParts = await downloadImageAsPart(source_image_url, "SOURCE IMAGE");
    parts.push(...sourceParts);

    if (reference_image_urls && Array.isArray(reference_image_urls)) {
        const referencePromises = reference_image_urls.map((url, index) => 
            downloadImageAsPart(url, `REFERENCE IMAGE ${index + 1}`)
        );
        const referencePartsArrays = await Promise.all(referencePromises);
        parts.push(...referencePartsArrays.flat());
    }

    const geminiResult = await ai.models.generateContent({
        model: GEMINI_MODEL_NAME,
        contents: [{ role: 'user', parts }],
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const enhancedPrompt = geminiResult.text;
    if (!enhancedPrompt) throw new Error("AI Helper did not return an enhanced prompt.");

    // --- Step 2: Image Generation with Fal.ai ---
    fal.config({ credentials: FAL_KEY });
    const allImageUrls = [source_image_url, ...(reference_image_urls || [])];

    const falResult: any = await fal.subscribe(FAL_MODEL_NAME, {
      input: {
        prompt: enhancedPrompt,
        image_urls: allImageUrls,
      },
      logs: true,
    });

    const finalImage = falResult?.images?.[0];
    if (!finalImage || !finalImage.url) throw new Error("Fal.ai did not return a valid image.");

    // --- Step 3: Finalize and Store ---
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const imageResponse = await fetch(finalImage.url);
    if (!imageResponse.ok) throw new Error("Failed to download final image from Fal.ai");
    const imageBuffer = await imageResponse.arrayBuffer();
    
    const finalFilePath = `${invoker_user_id}/edit-with-words/${Date.now()}_final.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(finalFilePath, imageBuffer, { contentType: 'image/png', upsert: true });
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);

    await supabase.from('mira-agent-comfyui-jobs').insert({
        user_id: invoker_user_id,
        status: 'complete',
        final_result: { publicUrl },
        metadata: {
            source: 'edit-with-words',
            prompt: enhancedPrompt,
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