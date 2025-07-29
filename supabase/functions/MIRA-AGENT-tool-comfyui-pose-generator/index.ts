import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

// --- NEW: Triage System Prompt ---
const TRIAGE_SYSTEM_PROMPT = `You are a task classification AI. Analyze the user's prompt and determine if their primary intent is to change the model's pose, change their garment, or both. Your response MUST be a single JSON object with one key, 'task_type', set to one of three possible string values: 'pose', 'garment', or 'both'.

Example 1:
User says "make her walk towards the camera."
Your Output: { "task_type": "pose" }

Example 2:
User says "change her shirt to a red t-shirt."
Your Output: { "task_type": "garment" }

Example 3:
User says "show him running, wearing a black hoodie."
Your Output: { "task_type": "both" }`;

// --- RENAMED: The original prompt, now specialized for POSE changes ---
const POSE_CHANGE_SYSTEM_PROMPT = `You are an expert prompt engineer for a powerful image-to-image editing model called "Kontext". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model. The final prompt must be in English and must not exceed 512 tokens.
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
This is the most important rule for any request involving more than one concept (e.g., "change A to be like B").
Technical Reality: The Kontext model only sees one image canvas. If a reference image is provided, it will be pre-processed onto that same canvas, typically side-by-side.
Your Mandate: DESCRIBE, DON'T POINT. You must never create a prompt that says "use the image on the right" or "like the reference image." This will fail.
Your Method: Your prompt must be self-contained. You must visually analyze the reference portion of the image, extract the key attributes (pattern, color, shape, texture, pose), and then verbally describe those attributes as the desired change for the content portion of the image.

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

IF YOU SEE THE SAME IDENTICAL IMAGE TWO TIMES, IGNORE THE REPETITION, FOCUS ON THE FIRST COPY

Your output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles, especially the Hyper-Detailed Identity Lockdown and the Golden Rule of Reference Handling, to construct a single, precise, and explicit instruction. Describe what to change, but describe what to keep in even greater detail.`;

// --- NEW: System prompt specialized for GARMENT changes ---
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

const unifiedWorkflowTemplate = `{
  "6": { "inputs": { "text": ["192", 0], "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "8": { "inputs": { "samples": ["197", 0], "vae": ["39", 0] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } },
  "35": { "inputs": { "guidance": 3.5, "conditioning": ["177", 0] }, "class_type": "FluxGuidance", "_meta": { "title": "FluxGuidance" } },
  "37": { "inputs": { "unet_name": "flux1-kontext-dev.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader", "_meta": { "title": "Load Diffusion Model" } },
  "38": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader", "_meta": { "title": "DualCLIPLoader" } },
  "39": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader", "_meta": { "title": "Load VAE" } },
  "124": { "inputs": { "pixels": ["214", 0], "vae": ["39", 0] }, "class_type": "VAEEncode", "_meta": { "title": "VAE Encode" } },
  "135": { "inputs": { "conditioning": ["6", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "177": { "inputs": { "conditioning": ["6", 0], "latent": ["124", 0] }, "class_type": "ReferenceLatent", "_meta": { "title": "ReferenceLatent" } },
  "190": { "inputs": { "prompt": ["232", 0], "safety_settings": "BLOCK_NONE", "response_type": "text", "model": "gemini-2.5-pro", "api_key": "AIzaSyByuyPAPHMnftan3cvqaZRTTwlGATYinnA", "proxy": "", "system_instruction": ["195", 0], "error_fallback_value": "", "seed": 1522985431, "temperature": 0.7500000000000001, "num_predict": 0, "image_1": ["214", 0], "image_2": ["229", 0] }, "class_type": "Ask_Gemini", "_meta": { "title": "Ask Gemini" } },
  "192": { "inputs": { "value": ["190", 0] }, "class_type": "PrimitiveString", "_meta": { "title": "String" } },
  "193": { "inputs": { "String": "placeholder_for_image_ref_task" }, "class_type": "String", "_meta": { "title": "editing task" } },
  "194": { "inputs": { "text_0": "For the woman with long, wavy platinum blonde hair, tanned skin, and a bright smile, change her pose to one where she is standing confidently with both hands on her hips. It is absolutely critical to preserve her exact identity, maintaining her specific facial structure, unique smile, brown eyes, and tanned skin tone. Her long, wavy platinum blonde hairstyle must remain identical. The two-piece, taupe-colored lingerie she is wearing must be preserved perfectly in style, color, and fit. The entire seamless gray studio background and the soft, diffused lighting must remain completely unchanged.", "text": ["192", 0] }, "class_type": "ShowText|pysssss", "_meta": { "title": "Show Text 🐍" } },
  "195": { "inputs": { "String": "placeholder_for_system_prompt" }, "class_type": "String", "_meta": { "title": "roleprompt for editing task" } },
  "196": { "inputs": { "cfg": 1, "nag_scale": 7.5, "nag_tau": 2.5, "nag_alpha": 0.25, "nag_sigma_end": 0.75, "model": ["212", 0], "positive": ["35", 0], "negative": ["135", 0], "nag_negative": ["198", 0], "latent_image": ["124", 0] }, "class_type": "NAGCFGGuider", "_meta": { "title": "NAGCFGGuider" } },
  "197": { "inputs": { "noise": ["200", 0], "guider": ["196", 0], "sampler": ["202", 0], "sigmas": ["204", 0], "latent_image": ["124", 0] }, "class_type": "SamplerCustomAdvanced", "_meta": { "title": "SamplerCustomAdvanced" } },
  "198": { "inputs": { "conditioning": ["6", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "200": { "inputs": { "noise_seed": 897192953094267 }, "class_type": "RandomNoise", "_meta": { "title": "RandomNoise" } },
  "202": { "inputs": { "sampler_name": "euler" }, "class_type": "KSamplerSelect", "_meta": { "title": "KSamplerSelect" } },
  "204": { "inputs": { "scheduler": "simple", "steps": 20, "denoise": 0.9200000000000002, "model": ["37", 0] }, "class_type": "BasicScheduler", "_meta": { "title": "BasicScheduler" } },
  "212": { "inputs": { "lora_name": "42lux-UltimateAtHome-flux-highresfix%20(1).safetensors", "strength_model": 0.12000000000000002, "strength_clip": 0.12000000000000002, "model": ["37", 0], "clip": ["38", 0] }, "class_type": "LoraLoader", "_meta": { "title": "Load LoRA" } },
  "213": { "inputs": { "filename_prefix": "ComfyUI", "images": ["8", 0] }, "class_type": "SaveImage", "_meta": { "title": "Output_BackUP-version" } },
  "214": { "inputs": { "image": "ComfyUI_00110_.png" }, "class_type": "LoadImage", "_meta": { "title": "Original_Image" } },
  "215": { "inputs": { "image": "ComfyUI_00111_.png" }, "class_type": "LoadImage", "_meta": { "title": "Pose_image" } },
  "217": { "inputs": { "String": "placeholder_for_text_ref_task" }, "class_type": "String", "_meta": { "title": "editing task" } },
  "229": { "inputs": { "select": ["230", 0], "images1": ["214", 0], "images2_opt": ["215", 0] }, "class_type": "ImageMaskSwitch", "_meta": { "title": "Switch (images, mask)" } },
  "230": { "inputs": { "Number": "1" }, "class_type": "Int", "_meta": { "title": "Switch with reference (2) or not (1) PROMPT" } },
  "232": { "inputs": { "select": ["230", 0], "sel_mode": false, "input1": ["217", 0], "input2": ["193", 0] }, "class_type": "ImpactSwitch", "_meta": { "title": "Switch (Any)" } }
}`;

async function downloadFromSupabase(supabase: any, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Supabase download failed: ${error.message}`);
    return data;
}

async function uploadToComfyUI(comfyUiUrl: string, imageBlob: Blob, filename: string) {
  const formData = new FormData();
  formData.append('image', imageBlob, filename);
  formData.append('overwrite', 'true');
  const uploadUrl = `${comfyUiUrl}/upload/image`;
  const response = await fetch(uploadUrl, { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`ComfyUI upload failed: ${await response.text()}`);
  const data = await response.json();
  return data.name;
}

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  const requestId = `pose-generator-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  if (!COMFYUI_ENDPOINT_URL) throw new Error("COMFYUI_ENDPOINT_URL is not set.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");

  try {
    const { base_model_url, pose_prompt, pose_image_url } = await req.json();
    if (!base_model_url || !pose_prompt) {
      throw new Error("base_model_url and pose_prompt are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    // --- Step 1: Triage the user's request ---
    console.log(`[PoseGenerator][${requestId}] Step 1: Classifying user intent...`);
    const triageResult = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite-preview-06-17",
        contents: [{ role: 'user', parts: [{ text: pose_prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: TRIAGE_SYSTEM_PROMPT }] } }
    });
    const { task_type } = extractJson(triageResult.text);
    console.log(`[PoseGenerator][${requestId}] Intent classified as: '${task_type}'`);

    // --- Step 2: Select the appropriate system prompt and dynamic task descriptions ---
    let selectedSystemPrompt: string;
    let editingTaskWithImage: string;
    let editingTaskWithText: string;

    switch (task_type) {
        case 'garment':
            selectedSystemPrompt = GARMENT_SWAP_SYSTEM_PROMPT;
            editingTaskWithImage = "change their garment to match my reference, keep everything else the same";
            editingTaskWithText = "change their garment to match my reference, IGNORE EVERYTHING ELSE OUTSIDE OF THE GARMENT, keep everything else the same";
            break;
        case 'both':
            selectedSystemPrompt = POSE_CHANGE_SYSTEM_PROMPT; // Defaulting to pose for now
            editingTaskWithImage = "change their pose and garment to match my reference, keep everything else the same";
            editingTaskWithText = "change their pose and garment to match my reference, IGNORE EVERYTHING ELSE OUTSIDE OF THE POSE AND GARMENT, keep everything else the same";
            break;
        case 'pose':
        default:
            selectedSystemPrompt = POSE_CHANGE_SYSTEM_PROMPT;
            editingTaskWithImage = "change their pose to match my reference, keep everything else the same";
            editingTaskWithText = "change their pose to match my reference, IGNORE EVERYTHING ELSE OUTSIDE OF THE POSE, keep everything else the same";
            break;
    }

    // --- Step 3: Proceed with the original logic, but using the selected prompt and tasks ---
    console.log(`[PoseGenerator][${requestId}] Step 2: Downloading base model from: ${base_model_url}`);
    const baseModelBlob = await downloadFromSupabase(supabase, base_model_url);
    const uniqueBaseModelFilename = `base_model_${requestId}.png`;
    const baseModelFilename = await uploadToComfyUI(sanitizedAddress, baseModelBlob, uniqueBaseModelFilename);
    console.log(`[PoseGenerator][${requestId}] Base model uploaded to ComfyUI as: ${baseModelFilename}`);

    const finalWorkflow = JSON.parse(unifiedWorkflowTemplate);
    finalWorkflow['214'].inputs.image = baseModelFilename;
    finalWorkflow['195'].inputs.String = selectedSystemPrompt;
    
    if (pose_image_url) {
      console.log(`[PoseGenerator][${requestId}] Pose reference image provided. Downloading from: ${pose_image_url}`);
      const poseImageBlob = await downloadFromSupabase(supabase, pose_image_url);
      const uniquePoseRefFilename = `pose_ref_${requestId}.png`;
      const poseImageFilename = await uploadToComfyUI(sanitizedAddress, poseImageBlob, uniquePoseRefFilename);
      
      finalWorkflow['215'].inputs.image = poseImageFilename;
      finalWorkflow['230'].inputs.Number = "2";
      finalWorkflow['193'].inputs.String = editingTaskWithImage;
      finalWorkflow['217'].inputs.String = ""; 
      console.log(`[PoseGenerator][${requestId}] Pose reference uploaded as: ${poseImageFilename}.`);
    } else {
      console.log(`[PoseGenerator][${requestId}] No pose reference image provided. Using text prompt.`);
      finalWorkflow['230'].inputs.Number = "1";
      const textRefTask = `${editingTaskWithText}. The user's specific instruction is: '${pose_prompt}'`;
      finalWorkflow['217'].inputs.String = textRefTask;
      finalWorkflow['193'].inputs.String = "";
    }

    const queueUrl = `${sanitizedAddress}/prompt`;
    const payload = { prompt: finalWorkflow };
    
    console.log(`[PoseGenerator][${requestId}] Step 3: Sending final payload to ComfyUI...`);
    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`ComfyUI server error: ${await response.text()}`);
    
    const data = await response.json();
    if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");
    console.log(`[PoseGenerator][${requestId}] Job queued successfully with prompt_id: ${data.prompt_id}`);

    return new Response(JSON.stringify({ comfyui_prompt_id: data.prompt_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[PoseGenerator][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});