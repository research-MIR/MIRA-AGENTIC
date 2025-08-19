import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, Part, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { fal } from 'npm:@fal-ai/client@1.5.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const FAL_KEY = Deno.env.get('FAL_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- System Prompts (Mirrored from ComfyUI tool for consistency) ---

const TRIAGE_SYSTEM_PROMPT = `You are a task classification and information extraction AI. Analyze the user's prompt and determine their primary intent. Your response MUST be a single JSON object with two keys: 'task_type' and 'garment_description'.

### Task Type Rules:
- If the user's primary intent is to change the model's pose, set 'task_type' to 'pose'.
- If the user's primary intent is to change the model's garment, set 'task_type' to 'garment'.
- If the user's intent is to change both the pose and the garment, set 'task_type' to 'both'.

### Garment Description Rules:
- If 'task_type' is 'garment' or 'both', you MUST extract the part of the user's prompt that describes the new clothing.
- The extracted description should be a concise, clear string.
- If 'task_type' is 'pose', 'garment_description' MUST be null.`;

const POSE_CHANGE_SYSTEM_PROMPT = `You are an expert prompt engineer for a powerful image-to-image editing model called "Kontext". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model. The final prompt must be in English and must not exceed 512 tokens.
Your process is to first apply the General Principles, then the crucial Reference Image Handling rule, and finally review the Advanced Examples to guide your prompt construction.
Part 1: General Principles for All Edits
These are your foundational rules for constructing any prompt.
A. Core Mandate: Specificity and Preservation
Be Specific: Always translate vague user requests into precise instructions.
Preserve by Default: Your most important task is to identify what should not change. Proactively add clauses to preserve key aspects of the image. This is especially true for the person's face and any clothing items not being explicitly changed. When in doubt, add a preservation instruction.
Identify Subjects Clearly: Never use vague pronouns. Describe the subject based on the reference image ("the man in the orange jacket").
B. Hyper-Detailed Character & Identity LOCKDOWN
This is one of your most critical tasks. A simple "preserve face" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.
Your Mandate:
Analyze & Describe: Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks','hairstyle' hair length').
Embed in Prompt: Weave these exact descriptions into your preservation clause to leave no room for interpretation.
C. Composition and Background Control
Example: "Change the background to a sunny beach while keeping the person in the exact same position, scale, and pose. Maintain the identical camera angle, framing, and perspective."
Part 2: Pose Generation Methodology (CRITICAL)
When the user requests a pose change, you MUST follow this two-step internal process to construct the final prompt:
1.  **Deconstruct the Pose:** First, mentally visualize the user's request (e.g., "a dancer leaping"). Break down this abstract action into a series of simple, declarative statements about the position of each major body part (torso, head, each arm, each leg).
2.  **Assemble the Final Prompt:** Construct the final prompt for the image model by combining your detailed identity preservation clauses with a clear, natural-language description of your deconstructed pose.
Part 3: The Golden Rule of Reference Image Handling
This is the most important rule for any request involving a reference image.
Your Mandate: DESCRIBE, DON'T POINT. You must never create a prompt that says "use the image on the right" or "like the reference image." This will fail.
Your Method: Your prompt must be self-contained. You must visually analyze the reference portion of the image, extract the key attributes (pattern, color, shape, texture, pose), and then verbally describe those attributes as the desired change for the content portion of the image.
Summary of Your Task:
IF YOU SEE THE SAME IDENTICAL IMAGE TWO TIMES, IGNORE THE REPETITION, FOCUS ON THE FIRST COPY.
Your output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles, especially the Hyper-Detailed Identity Lockdown and the Pose Deconstruction Methodology, to construct a single, precise, and explicit instruction. Describe what to change, but describe what to keep in even greater detail.`;

const GARMENT_SWAP_SYSTEM_PROMPT = `You are an expert prompt engineer for a powerful image-to-image editing model called "Kontext". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model to **swap a model's clothing while preserving their pose and identity**. The final prompt must be in English and must not exceed 512 tokens.
### Core Operating Principles & Methodologies
**I. Pose Preservation Mandate (HIGHEST PRIORITY):**
Your most critical task is to ensure the model's pose does not change.
1.  **Analyze the Pose:** You MUST visually analyze the pose in the SOURCE IMAGE.
2.  **Describe the Pose:** In your final prompt, you MUST include a detailed, explicit description of the model's pose (e.g., "standing with hands on hips," "walking towards the camera," "sitting with legs crossed").
3.  **Lock the Pose:** Your prompt MUST contain a clause like "It is absolutely critical to preserve the model's exact pose, including their arm, leg, and head position."
**II. Hyper-Detailed Character & Identity LOCKDOWN:**
This is your second most critical task. A simple "preserve face" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.
- **Analyze & Describe:** Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks').
- **Embed in Prompt:** Weave these exact descriptions into your preservation clause to leave no room for interpretation.
**III. Background & Lighting Preservation:**
You MUST describe the background and lighting from the source image and include a command to preserve them perfectly.
**IV. The Creative Task: Garment Swapping**
- Your primary creative task is to describe the new garment requested by the user.
- Replace the description of the model's current clothing with a hyper-detailed description of the new garment.
- If the user provides a reference image for the garment, you must follow the "Golden Rule of Reference Image Handling": visually analyze the reference, extract its key attributes (color, pattern, texture, fit), and verbally describe those attributes in your prompt. DO NOT say "make it look like the reference."
### Your Output:
Your output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles to construct a single, precise, and explicit instruction. Describe what to change (the garment), but describe what to keep (pose, identity, background, lighting) in even greater detail.`;

// --- Helper Functions ---

function extractJson(text: string): any {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match && match[1]) return JSON.parse(match[1]);
  try { return JSON.parse(text); } catch (e) {
    throw new Error("The model returned a response that could not be parsed as JSON.");
  }
}

async function downloadImageAsPart(supabase: SupabaseClient, publicUrl: string, label: string): Promise<Part[]> {
  const url = new URL(publicUrl);
  const pathSegments = url.pathname.split('/');
  const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
  const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
  const { data, error } = await supabase.storage.from(bucketName).download(filePath);
  if (error) throw new Error(`Failed to download ${label}: ${error.message}`);
  const buffer = await data.arrayBuffer();
  const base64 = encodeBase64(buffer);
  return [{ text: `--- ${label} ---` }, { inlineData: { mimeType: data.type, data: base64 } }];
}

// --- Main Handler ---

serve(async (req) => {
  const requestId = `fal-kontext-edit-${Date.now()}`;
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id, base_model_url, pose_prompt, pose_image_url } = await req.json();
  if (!job_id || !base_model_url || !pose_prompt) {
    throw new Error("job_id, base_model_url, and pose_prompt are required.");
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[FalKontextTool][${job_id}]`;

  try {
    console.log(`${logPrefix} Starting job for pose: "${pose_prompt}"`);

    // 1. Fetch job data for context
    const { data: job, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('metadata').eq('id', job_id).single();
    if (fetchError) throw fetchError;
    const identityPassport = job.metadata?.identity_passport;

    // 2. Triage user intent
    console.log(`${logPrefix} Step 1: Classifying user intent...`);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const triageResult = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite-preview-06-17",
      contents: [{ role: 'user', parts: [{ text: pose_prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
      config: { systemInstruction: { role: "system", parts: [{ text: TRIAGE_SYSTEM_PROMPT }] } }
    });
    const { task_type, garment_description } = extractJson(triageResult.text);
    console.log(`${logPrefix} Intent classified as: '${task_type}'.`);

    // 3. Engineer the final prompt
    console.log(`${logPrefix} Step 2: Engineering final prompt...`);
    let selectedSystemPrompt;
    let baseEditingTask;
    if (task_type === 'garment') {
      selectedSystemPrompt = GARMENT_SWAP_SYSTEM_PROMPT;
      baseEditingTask = `change their garment to: ${garment_description}`;
    } else { // 'pose' or 'both'
      selectedSystemPrompt = POSE_CHANGE_SYSTEM_PROMPT;
      baseEditingTask = pose_prompt;
    }

    let enrichedEditingTask = `User Request: "${baseEditingTask}"`;
    if (identityPassport) {
      const passportText = `Identity Constraints: The model MUST have ${identityPassport.skin_tone}, ${identityPassport.hair_style}, and ${identityPassport.eye_color}. These features must be preserved perfectly.`;
      enrichedEditingTask = `${passportText}\n\n${enrichedEditingTask}`;
    }

    const promptEngineeringParts: Part[] = [{ text: enrichedEditingTask }];
    const baseModelImageParts = await downloadImageAsPart(supabase, base_model_url, "SOURCE IMAGE");
    promptEngineeringParts.push(...baseModelImageParts);
    if (pose_image_url) {
      const poseRefParts = await downloadImageAsPart(supabase, pose_image_url, "REFERENCE IMAGE");
      promptEngineeringParts.push(...poseRefParts);
    }

    const finalPromptResult = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [{ role: 'user', parts: promptEngineeringParts }],
      config: { systemInstruction: { role: "system", parts: [{ text: selectedSystemPrompt }] } }
    });
    const finalPrompt = finalPromptResult.text;
    console.log(`${logPrefix} Final prompt engineered: "${finalPrompt.substring(0, 100)}..."`);

    // 4. Call Fal.ai API
    console.log(`${logPrefix} Step 3: Calling Fal.ai 'qwen-image-edit' model...`);
    fal.config({ credentials: FAL_KEY });
    const falResult: any = await fal.subscribe("fal-ai/qwen-image-edit", {
      input: { prompt: finalPrompt, image_url: base_model_url },
      logs: true,
    });
    const finalImage = falResult?.images?.[0];
    if (!finalImage || !finalImage.url) throw new Error("Fal.ai did not return a valid image.");

    // 5. Upload result to Supabase Storage
    console.log(`${logPrefix} Step 4: Uploading final image to storage...`);
    const imageResponse = await fetch(finalImage.url);
    const imageBuffer = await imageResponse.arrayBuffer();
    const filePath = `${job.user_id}/model-poses/${Date.now()}_fal_pose.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

    // 6. Update the main job record
    console.log(`${logPrefix} Step 5: Updating main job record...`);
    const { data: currentJob, error: fetchError2 } = await supabase.from('mira-agent-model-generation-jobs').select('final_posed_images').eq('id', job_id).single();
    if (fetchError2) throw fetchError2;
    const updatedPoses = (currentJob.final_posed_images || []).map((pose: any) => {
      if (pose.pose_prompt === pose_prompt) {
        return { ...pose, status: 'analyzing', final_url: publicUrl, analysis_started_at: new Date().toISOString() };
      }
      return pose;
    });
    await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoses }).eq('id', job_id);

    // 7. Trigger QA
    console.log(`${logPrefix} Step 6: Triggering final QA analysis...`);
    await supabase.functions.invoke('MIRA-AGENT-analyzer-pose-image', {
      body: { job_id, image_url: publicUrl, base_model_image_url, pose_prompt }
    });

    console.log(`${logPrefix} Job complete.`);
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    // Attempt to mark the specific pose as failed in the main job
    try {
        const { data: job, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('final_posed_images').eq('id', job_id).single();
        if (!fetchError && job) {
            const updatedPoses = (job.final_posed_images || []).map((pose: any) => {
                if (pose.pose_prompt === body.pose_prompt) {
                    return { ...pose, status: 'failed', error_message: `Fal.ai tool failed: ${error.message}` };
                }
                return pose;
            });
            await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoses }).eq('id', job_id);
        }
    } catch (updateErr) {
        console.error(`${logPrefix} Failed to mark pose as failed after an error:`, updateErr);
    }
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});