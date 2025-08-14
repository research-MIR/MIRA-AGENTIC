import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

const TRIAGE_SYSTEM_PROMPT = `You are a task classification and information extraction AI. Analyze the user's prompt and determine their primary intent. Your response MUST be a single JSON object with two keys: 'task_type' and 'garment_description'.

### Task Type Rules:
- If the user's primary intent is to change the model's pose, set 'task_type' to 'pose'.
- If the user's primary intent is to change the model's garment, set 'task_type' to 'garment'.
- If the user's intent is to change both the pose and the garment, set 'task_type' to 'both'.

### Garment Description Rules:
- If 'task_type' is 'garment' or 'both', you MUST extract the part of the user's prompt that describes the new clothing.
- The extracted description should be a concise, clear string.
- If 'task_type' is 'pose', 'garment_description' MUST be null.

### Examples:

**Example 1:**
User says "make her walk towards the camera."
Your Output:
\`\`\`json
{
  "task_type": "pose",
  "garment_description": null
}
\`\`\`

**Example 2:**
User says "change her shirt to a red t-shirt."
Your Output:
\`\`\`json
{
  "task_type": "garment",
  "garment_description": "a red t-shirt"
}
\`\`\`

**Example 3:**
User says "show him running, wearing a black hoodie."
Your Output:
\`\`\`json
{
  "task_type": "both",
  "garment_description": "a black hoodie"
}
\`\`\`
`;

const POSE_CHANGE_SYSTEM_PROMPT = `You are an expert prompt engineer for a powerful image-to-image editing model called "Kontext". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model. The final prompt must be in English and must not exceed 512 tokens.

### Part 1: General Principles for All Edits
These are your foundational rules for constructing any prompt.
A. Core Mandate: Specificity and Preservation
Be Specific: Always translate vague user requests into precise instructions.
Preserve by Default: Your most important task is to identify what should not change. Proactively add clauses to preserve key aspects of the image. When in doubt, add a preservation instruction.
Identify Subjects Clearly: Never use vague pronouns. Describe the subject based on the reference image ("the man in the orange jacket").

B. Hyper-Detailed Character & Identity LOCKDOWN
This is one of your most critical tasks. A simple "preserve face" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.
Your Mandate:
Analyze & Describe: Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks','hairstyle' hair length').
Embed in Prompt: Weave these exact descriptions into your preservation clause to leave no room for interpretation.

C. Composition and Background Control
Example: "Change the background to a sunny beach while keeping the person in the exact same position, scale, and pose. Maintain the identical camera angle, framing, and perspective."

### Part 2: Pose Generation Methodology (CRITICAL)
When the user requests a pose change, you MUST follow this two-step internal process to construct the final prompt:
1.  **Deconstruct the Pose:** First, mentally visualize the user's request (e.g., "a dancer leaping"). Break down this abstract action into a series of simple, declarative statements about the position of each major body part (torso, head, each arm, each leg).
2.  **Assemble the Final Prompt:** Construct the final prompt for the image model by combining your detailed identity preservation clauses with a clear, natural-language description of your deconstructed pose.

**Example of Pose Deconstruction:**
-   **User Request:** "make her jump in the air"
-   **Your Internal Deconstruction:** *Okay, "jump in the air" means both feet are off the ground. Let's say one leg is bent forward and the other is bent back. Arms are out to the sides for balance.*
-   **Your Final Prompt Output:** *"For the model with fair skin and long blonde hair, change her pose so that both feet are off the ground, with her left leg bent forward at the knee and her right leg bent back. Her arms should be extended out to her sides for balance. It is critical to preserve her exact facial features... The background must remain unchanged..."*

### Part 3: The Golden Rule of Reference Image Handling
This is the most important rule for any request involving more than one concept (e.g., "change A to be like B").
Technical Reality: The Kontext model only sees one image canvas. If a reference image is provided, it will be pre-processed onto that same canvas, typically side-by-side.
Your Mandate: DESCRIBE, DON'T POINT. You must never create a prompt that says "use the image on the right" or "like the reference image." This will fail.
Your Method: Your prompt must be self-contained. You must visually analyze the reference portion of the image, extract the key attributes (pattern, color, shape, texture, pose), and then verbally describe those attributes as the desired change for the content portion of the image.

### Summary of Your Task:
IF YOU SEE THE SAME IDENTICAL IMAGE TWO TIMES, IGNORE THE REPETITION, FOCUS ON THE FIRST COPY.
Your output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles, especially the Hyper-Detailed Identity Lockdown and the Pose Deconstruction Methodology, to construct a single, precise, and explicit instruction. Describe what to change, but describe what to keep in even greater detail.`;

const GARMENT_SWAP_SYSTEM_PROMPT = `You are an expert prompt engineer for a powerful image-to-image editing model called "Kontext". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model to **swap a model's clothing while preserving their pose and identity**. The final prompt must be in English and must not exceed 512 tokens.

### Core Operating Principles & Methodologies

**I. General Principles for All Edits**
These are your foundational rules for constructing any prompt.
A. Core Mandate: Specificity and Preservation
Be Specific: Always translate vague user requests into precise instructions.
Preserve by Default: Your most important task is to identify what should not change. Proactively add clauses to preserve key aspects of the image. This is especially true for the person's face, pose, and any clothing items not being explicitly changed. When in doubt, add a preservation instruction.
Identify Subjects Clearly: Never use vague pronouns. Describe the subject based on the reference image ("the man in the orange jacket").

B. Hyper-Detailed Character & Identity LOCKDOWN
This is one of your most critical tasks. A simple "preserve face" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.
Your Mandate:
Analyze & Describe: Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks').
Embed in Prompt: Weave these exact descriptions into your preservation clause to leave no room for interpretation.

C. Pose Preservation Mandate
Your second most critical task is to ensure the model's pose does not change.
1.  **Analyze the Pose:** You MUST visually analyze the pose in the SOURCE IMAGE.
2.  **Describe the Pose:** In your final prompt, you MUST include a detailed, explicit description of the model's pose (e.g., "standing with hands on hips," "walking towards the camera," "sitting with legs crossed").
3.  **Lock the Pose:** Your prompt MUST contain a clause like "It is absolutely critical to preserve the model's exact pose, including their arm, leg, and head position."

D. Composition and Background Control
You MUST describe the background and lighting from the source image and include a command to preserve them perfectly. Example: "Maintain the identical camera angle, framing, and perspective. The background, a bustling city street with yellow taxis and glass-front buildings, must be preserved in every detail, including the specific reflections and the soft daytime lighting."

**II. The Golden Rule of Reference Image Handling**
This is the most important rule for any request involving a reference image.
Technical Reality: The Kontext model only sees one image canvas. If a reference image is provided, it will be pre-processed onto that same canvas, typically side-by-side.
Your Mandate: DESCRIBE, DON'T POINT. You must never create a prompt that says "use the reference image" or "make it look like the other picture." This will fail.
Your Method: Your prompt must be self-contained. You must visually analyze the reference portion of the image, extract the key attributes (color, pattern, texture, fit), and then verbally describe those attributes as the desired change for the content portion of the image.

**III. The Creative Task: Garment Swapping**
- Your primary creative task is to describe the new garment requested by the user.
- Replace the description of the model's current clothing with a hyper-detailed description of the new garment.

### Your Output:
Your output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles to construct a single, precise, and explicit instruction. Describe what to change (the garment), but describe what to keep (pose, identity, background, lighting) in even greater detail.`;

const twoPassWorkflowTemplate = `{
  "6": { "inputs": { "text": ["192", 0], "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "35": { "inputs": { "guidance": 3.5, "conditioning": ["177", 0] }, "class_type": "FluxGuidance", "_meta": { "title": "FluxGuidance" } },
  "37": { "inputs": { "unet_name": "flux1-kontext-dev.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader", "_meta": { "title": "Load Diffusion Model" } },
  "38": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader", "_meta": { "title": "DualCLIPLoader" } },
  "39": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader", "_meta": { "title": "Load VAE" } },
  "124": { "inputs": { "pixels": ["214", 0], "vae": ["39", 0] }, "class_type": "VAEEncode", "_meta": { "title": "VAE Encode" } },
  "135": { "inputs": { "conditioning": ["250", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "177": { "inputs": { "conditioning": ["6", 0], "latent": ["124", 0] }, "class_type": "ReferenceLatent", "_meta": { "title": "ReferenceLatent" } },
  "190": { "inputs": { "prompt": ["232", 0], "safety_settings": "BLOCK_NONE", "response_type": "text", "model": "gemini-2.5-pro", "api_key": "AIzaSyByuyPAPHMnftan3cvqaZRTTwlGATYinnA", "proxy": "", "system_instruction": ["195", 0], "error_fallback_value": "", "seed": 1279390168, "temperature": 0.7500000000000001, "num_predict": 0, "image_1": ["214", 0], "image_2": ["229", 0] }, "class_type": "Ask_Gemini", "_meta": { "title": "Ask Gemini" } },
  "192": { "inputs": { "value": ["190", 0] }, "class_type": "PrimitiveString", "_meta": { "title": "String" } },
  "193": { "inputs": { "String": "change their pose to match my reference, keep everything else the same,IGNORE EVERYTHING ELSE OUTSIDE OF THE POSE" }, "class_type": "String", "_meta": { "title": "editing task" } },
  "194": { "inputs": { "text_0": "For the woman with dark skin, a very short black haircut, high cheekbones, and a slender build, change her pose to a full-frontal standing position, looking directly at the camera, with her arms resting naturally at her sides and feet slightly apart. It is absolutely critical to preserve her exact identity, including her specific facial features and deep skin tone. The light gray underwire bra and matching briefs she is wearing must remain completely unchanged in color, style, and fit. The plain, light gray studio background, the soft shadows, and the diffuse frontal lighting must also be kept identical to the original image.", "text": ["192", 0] }, "class_type": "ShowText|pysssss", "_meta": { "title": "Show Text 🐍" } },
  "195": { "inputs": { "String": "You are an expert prompt engineer for a powerful image-to-image editing model called \\"Kontext\\". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model. The final prompt must be in English and must not exceed 512 tokens.\\nYour process is to first apply the General Principles, then the crucial Reference Image Handling rule, and finally review the Advanced Examples to guide your prompt construction.\\nPart 1: General Principles for All Edits\\nThese are your foundational rules for constructing any prompt.\\nA. Core Mandate: Specificity and Preservation\\nBe Specific: Always translate vague user requests into precise instructions.\\nPreserve by Default: Your most important task is to identify what should not change. Proactively add clauses to preserve key aspects of the image. When in doubt, add a preservation instruction.\\nIdentify Subjects Clearly: Never use vague pronouns. Describe the subject based on the reference image (\\"the man in the orange jacket\\").\\nB. Verb Choice is Crucial\\nUse controlled verbs like \\"Change,\\" \\"Replace,\\" \\"Add,\\" or \\"Remove\\" for targeted edits.\\nUse \\"Transform\\" only for significant, holistic style changes.\\nC. Hyper-Detailed Character & Identity LOCKDOWN\\nThis is one of your most critical tasks. A simple \\"preserve face\\" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.\\nYour Mandate:\\nAnalyze & Describe: Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks').\\nEmbed in Prompt: Weave these exact descriptions into your preservation clause to leave no room for interpretation.\\nExample of Application:\\nUser Request: \\"Make this man a viking.\\"\\nWeak Prompt (AVOID): \\"Change the man's clothes to a viking warrior's outfit while preserving his face.\\"\\nStrong Prompt (CORRECT): \\"For the man with a square jaw, light olive skin, short dark hair, and brown eyes, change his clothes to a viking warrior's outfit. It is absolutely critical to preserve his exact identity by maintaining these specific features: his square jaw, light olive skin tone, unique nose and mouth shape, and brown eyes.\\"\\nD. Composition and Background Control\\nExample: \\"Change the background to a sunny beach while keeping the person in the exact same position, scale, and pose. Maintain the identical camera angle, framing, and perspective.\\"\\nE. Text Editing: Use a Strict Format\\nFormat: Replace '[original text]' with '[new text]'\\nF. Style Transfer (via Text)\\nNamed Style: \\"Transform to a 1960s pop art poster style.\\"\\nDescribed Style: \\"Convert to a pencil sketch with natural graphite lines and visible paper texture.\\"\\nPart 2: The Golden Rule of Reference Image Handling\\nThis is the most important rule for any request involving more than one concept (e.g., \\"change A to be like B\\").\\nTechnical Reality: The Kontext model only sees one image canvas. If a reference image is provided, it will be pre-processed onto that same canvas, typically side-by-side.\\nYour Mandate: DESCRIBE, DON'T POINT. You must never create a prompt that says \\"use the image on the right\\" or \\"like the reference image.\\" This will fail.\\nYour Method: Your prompt must be self-contained. You must visually analyze the reference portion of the image, extract the key attributes (pattern, color, shape, texture, pose), and then verbally describe those attributes as the desired change for the content portion of the image.\\nPart 3: Advanced, Detailed Examples (The Principle of Hyper-Preservation)\\nThis principle is key: Whatever doesn't need to be changed must be described and locked down in extreme detail, embedding descriptions directly into the prompt.\\nExample 1: Clothing Change (Preserving Person and Background)\\nUser Request: \\"Change his t-shirt to blue.\\"\\nYour Optimized Prompt: \\"For the man with fair skin, a short black haircut, a defined jawline, and a slight smile, change his red crew-neck t-shirt to a deep royal blue color. It is absolutely critical to preserve his exact identity, including his specific facial structure, hazel eyes, and fair skin tone. His pose, the black jeans he is wearing, and his white sneakers must remain identical. The background, a bustling city street with yellow taxis and glass-front buildings, must be preserved in every detail, including the specific reflections and the soft daytime lighting.\\"\\nExample 2: Background Change (Preserving Subject and Lighting)\\nUser Request: \\"Put her in Paris.\\"\\nYour Optimized Prompt: \\"For the woman with long blonde hair, fair skin, and blue eyes, change the background to an outdoor Parisian street cafe with the Eiffel Tower visible in the distant background. It is critical to keep the woman perfectly intact. Her seated pose, with one hand on the white coffee cup, must not change. Preserve her exact facial features (thin nose, defined cheekbones), her makeup, her fair skin tone, and the precise folds and emerald-green color of her dress. The warm, soft lighting on her face and dress from the original image must be maintained.\\"\\nExample 3: Reference on Canvas - Object Swap (Applying The Golden Rule)\\nUser Request: \\"Change his jacket to be like that shirt.\\"\\nReference Context: Canvas with man in orange jacket (left) and striped shirt (right).\\nYour Optimized Prompt: \\"For the man on the left, who has a short fade haircut, light-brown skin, and is wearing sunglasses, replace his orange bomber jacket with a short-sleeved, collared shirt featuring a pattern of thin, horizontal red and white stripes. It is critical to preserve his exact identity, including his specific facial structure and light-brown skin tone, as well as his pose and the entire original background of the stone building facade.\\"\\nSummary of Your Task:\\n\\nIF YOU SEE THE SAME IDENTICAL IMAGE TWO TIMES, IGNORE THE REPETITION, FOCUS ON THE FIRST COPY\\n\\nYour output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles, especially the Hyper-Detailed Identity Lockdown and the Golden Rule of Reference Handling, to construct a single, precise, and explicit instruction. Describe what to change, but describe what to keep in even greater detail. " }, "class_type": "String", "_meta": { "title": "roleprompt for editing task" } },
  "196": { "inputs": { "cfg": 1, "nag_scale": 7.5, "nag_tau": 2.5, "nag_alpha": 0.25, "nag_sigma_end": 0.75, "model": ["212", 0], "positive": ["35", 0], "negative": ["135", 0], "nag_negative": ["198", 0], "latent_image": ["124", 0] }, "class_type": "NAGCFGGuider", "_meta": { "title": "NAGCFGGuider" } },
  "197": { "inputs": { "noise": ["200", 0], "guider": ["196", 0], "sampler": ["202", 0], "sigmas": ["204", 0], "latent_image": ["124", 0] }, "class_type": "SamplerCustomAdvanced", "_meta": { "title": "SamplerCustomAdvanced" } },
  "198": { "inputs": { "conditioning": ["250", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "200": { "inputs": { "noise_seed": 315883858628164 }, "class_type": "RandomNoise", "_meta": { "title": "RandomNoise" } },
  "202": { "inputs": { "sampler_name": "euler" }, "class_type": "KSamplerSelect", "_meta": { "title": "KSamplerSelect" } },
  "204": { "inputs": { "scheduler": "simple", "steps": 20, "denoise": 0.8500000000000002, "model": ["37", 0] }, "class_type": "BasicScheduler", "_meta": { "title": "BasicScheduler" } },
  "212": { "inputs": { "lora_name": "42lux-UltimateAtHome-flux-highresfix%20(1).safetensors", "strength_model": 0.12000000000000002, "strength_clip": 0.12000000000000002, "model": ["37", 0], "clip": ["38", 0] }, "class_type": "LoraLoader", "_meta": { "title": "Load LoRA" } },
  "213": { "inputs": { "filename_prefix": "ComfyUI", "images": ["273", 0] }, "class_type": "SaveImage", "_meta": { "title": "Output_BackUP-version" } },
  "214": { "inputs": { "image": "119a4a99-34f0-4782-979a-926599aec987.jpg" }, "class_type": "LoadImage", "_meta": { "title": "Original_Image" } },
  "215": { "inputs": { "image": "ComfyUI_00111_.png" }, "class_type": "LoadImage", "_meta": { "title": "Pose_image" } },
  "229": { "inputs": { "select": ["230", 0], "images1": ["214", 0], "images2_opt": ["215", 0] }, "class_type": "ImageMaskSwitch", "_meta": { "title": "Switch (images, mask)" } },
  "230": { "inputs": { "Number": "1" }, "class_type": "Int", "_meta": { "title": "Switch with reference (2) or not (1) PROMPT" } },
  "232": { "inputs": { "select": ["230", 0], "sel_mode": false, "input1": ["193", 0], "input2": ["193", 0] }, "class_type": "ImpactSwitch", "_meta": { "title": "Switch (Any)" } },
  "233": { "inputs": { "cfg": 1, "nag_scale": 6.03, "nag_tau": 2.5, "nag_alpha": 0.25, "nag_sigma_end": 0.85, "model": ["212", 0], "positive": ["246", 0], "negative": ["244", 0], "nag_negative": ["242", 0], "latent_image": ["197", 0] }, "class_type": "NAGCFGGuider", "_meta": { "title": "NAGCFGGuider" } },
  "235": { "inputs": { "noise": ["200", 0], "guider": ["233", 0], "sampler": ["202", 0], "sigmas": ["271", 0], "latent_image": ["197", 0] }, "class_type": "SamplerCustomAdvanced", "_meta": { "title": "SamplerCustomAdvanced" } },
  "236": { "inputs": { "samples": ["235", 0], "vae": ["39", 0] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } },
  "242": { "inputs": { "conditioning": ["249", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "243": { "inputs": { "text": ["247", 0], "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "244": { "inputs": { "conditioning": ["249", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "245": { "inputs": { "conditioning": ["243", 0], "latent": ["197", 0] }, "class_type": "ReferenceLatent", "_meta": { "title": "ReferenceLatent" } },
  "246": { "inputs": { "guidance": 3.5, "conditioning": ["245", 0] }, "class_type": "FluxGuidance", "_meta": { "title": "FluxGuidance" } },
  "247": { "inputs": { "value": ["248", 0] }, "class_type": "PrimitiveString", "_meta": { "title": "String" } },
  "248": { "inputs": { "prompt": ["256", 0], "safety_settings": "BLOCK_NONE", "response_type": "text", "model": "gemini-2.5-pro", "api_key": "AIzaSyByuyPAPHMnftan3cvqaZRTTwlGATYinnA", "proxy": "", "system_instruction": ["253", 0], "error_fallback_value": "", "seed": 1507425843, "temperature": 0.7500000000000001, "num_predict": 0, "image_1": ["254", 0] }, "class_type": "Ask_Gemini", "_meta": { "title": "Ask Gemini" } },
  "249": { "inputs": { "text": "", "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "250": { "inputs": { "text": "", "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "252": { "inputs": { "String": "change their garment to match my reference (it being a prompt or a textual prompt), keep everything else the same - do nto add unrequested additions otuside the only excplicit garment requested DO NOT TRY TO FINISH OUTFITS OR CLOTHING SETS, DO NOT - JUST DESCRIBE THE SWAP TO ADD ESCLUSIVELY THE REQUESTED GARMENT AND LEAVIN THE REST UNTOUCHED - AND REMEMBER TO CLARIFY THAT COLOR CORRECTION, COLOR OF THE SKIN, COLOR OF THE scene HAVE TO CONTINUE BEING THE SMAE AS THE ORIGINAL - here the reference requested that has to be completely inserted realsitically in the scene (if you ask to change the bra for another upper body garment remeber it must be closed not opened (the garment) and you have to explain instead of the bra and telling it what body area would it cover (a jacket would not just cover the area a bra would), just request the addition:" }, "class_type": "String", "_meta": { "title": "editing task" } },
  "253": { "inputs": { "String": "You are an expert prompt engineer for a powerful image-to-image editing model called \\"Kontext\\". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model to **swap a model's clothing while preserving their pose and identity**. The final prompt must be in English and must not exceed 512 tokens.\\n\\n### Core Operating Principles & Methodologies\\n\\n**I. Pose Preservation Mandate (HIGHEST PRIORITY):**\\nYour most critical task is to ensure the model's pose does not change.\\n1.  **Analyze the Pose:** You MUST visually analyze the pose in the SOURCE IMAGE.\\n2.  **Describe the Pose:** In your final prompt, you MUST include a detailed, explicit description of the model's pose (e.g., \\"standing with hands on hips,\\" \\"walking towards the camera,\\" \\"sitting with legs crossed\\").\\n3.  **Lock the Pose:** Your prompt MUST contain a clause like \\"It is absolutely critical to preserve the model's exact pose, including their arm, leg, and head position.\\"\\n\\n**II. Hyper-Detailed Character & Identity LOCKDOWN:**\\nThis is your second most critical task. A simple \\"preserve face\\" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.\\n- **Analyze & Describe:** Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks').\\n- **Embed in Prompt:** Weave these exact descriptions into your preservation clause to leave no room for interpretation.\\n\\n**III. Background & Lighting Preservation:**\\nYou MUST describe the background and lighting from the source image and include a command to preserve them perfectly.\\n\\n**IV. The Creative Task: Garment Swapping**\\n- Your primary creative task is to describe the new garment requested by the user.\\n- Replace the description of the model's current clothing with a hyper-detailed description of the new garment.\\n- If the user provides a reference image for the garment, you must follow the \\"Golden Rule of Reference Image Handling\\": visually analyze the reference, extract its key attributes (color, pattern, texture, fit), and verbally describe those attributes in your prompt. DO NOT say \\"make it look like the reference.\\"\\n\\n### Your Output:\\nYour output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles to construct a single, precise, and explicit instruction. Describe what to change (the garment), but describe what to keep (pose, identity, background, lighting) in even greater detail." }, "class_type": "String", "_meta": { "title": "roleprompt for editing task" } },
  "254": { "inputs": { "samples": ["197", 0], "vae": ["39", 0] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } },
  "256": { "inputs": { "string_a": ["252", 0], "string_b": ["257", 0], "delimiter": "" }, "class_type": "StringConcatenate", "_meta": { "title": "Concatenate" } },
  "257": { "inputs": { "String": "A RED JACKET" }, "class_type": "String", "_meta": { "title": "garment request" } },
  "263": { "inputs": { "text_0": "Replace the light grey bra on the model with a closed, vibrant red jacket. The jacket should realistically cover her torso. Leave the model's grey underwear completely untouched.\\n\\nIt is essential to perfectly preserve the model's identity as a Black woman with a dark, rich skin tone, high cheekbones, full lips, dark brown eyes, and very short, cropped black hair. Do not alter her facial features, skin color, or hair in any way.\\n\\nIt is absolutely critical to preserve the model's exact pose: standing straight in a full-body studio shot, facing the camera directly with her arms relaxed at her sides, head level, and feet close together. Her arm, leg, and head positions must not change.\\n\\nMaintain the original background, which is a seamless, plain light grey studio backdrop. The lighting must also be preserved exactly as it is: soft, diffuse studio lighting from the front, maintaining the original color temperature, highlights, and shadow placement on her body and the background.", "text": ["248", 0] }, "class_type": "ShowText|pysssss", "_meta": { "title": "Show Text 🐍" } },
  "271": { "inputs": { "scheduler": "simple", "steps": 25, "denoise": 0.9000000000000001, "model": ["212", 0] }, "class_type": "BasicScheduler", "_meta": { "title": "BasicScheduler" } },
  "273": { "inputs": { "clamp": true, "gamma": 1, "contrast": 1, "exposure": 0, "offset": 0, "hue": 0, "saturation": 1.1000000000000003, "value": 1, "image": ["236", 0] }, "class_type": "Color Correct (mtb)", "_meta": { "title": "Color Correct (mtb)" } }
}`;

const singlePassWorkflowTemplate = `{
  "6": { "inputs": { "text": ["192", 0], "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "35": { "inputs": { "guidance": 3.5, "conditioning": ["177", 0] }, "class_type": "FluxGuidance", "_meta": { "title": "FluxGuidance" } },
  "37": { "inputs": { "unet_name": "flux1-kontext-dev.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader", "_meta": { "title": "Load Diffusion Model" } },
  "38": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader", "_meta": { "title": "DualCLIPLoader" } },
  "39": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader", "_meta": { "title": "Load VAE" } },
  "124": { "inputs": { "pixels": ["214", 0], "vae": ["39", 0] }, "class_type": "VAEEncode", "_meta": { "title": "VAE Encode" } },
  "135": { "inputs": { "conditioning": ["250", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "177": { "inputs": { "conditioning": ["6", 0], "latent": ["124", 0] }, "class_type": "ReferenceLatent", "_meta": { "title": "ReferenceLatent" } },
  "190": { "inputs": { "prompt": ["232", 0], "safety_settings": "BLOCK_NONE", "response_type": "text", "model": "gemini-2.5-pro", "api_key": "AIzaSyByuyPAPHMnftan3cvqaZRTTwlGATYinnA", "proxy": "", "system_instruction": ["195", 0], "error_fallback_value": "", "seed": 1551174521, "temperature": 0.7500000000000001, "num_predict": 0, "image_1": ["214", 0], "image_2": ["229", 0] }, "class_type": "Ask_Gemini", "_meta": { "title": "Ask Gemini" } },
  "192": { "inputs": { "value": ["190", 0] }, "class_type": "PrimitiveString", "_meta": { "title": "String" } },
  "193": { "inputs": { "String": "change their pose to match my reference, keep everything else the same,IGNORE EVERYTHING ELSE OUTSIDE OF THE POSE" }, "class_type": "String", "_meta": { "title": "editing task" } },
  "195": { "inputs": { "String": "placeholder_for_system_prompt" }, "class_type": "String", "_meta": { "title": "roleprompt for editing task" } },
  "196": { "inputs": { "cfg": 1, "nag_scale": 7.5, "nag_tau": 2.5, "nag_alpha": 0.25, "nag_sigma_end": 0.75, "model": ["212", 0], "positive": ["35", 0], "negative": ["135", 0], "nag_negative": ["198", 0], "latent_image": ["124", 0] }, "class_type": "NAGCFGGuider", "_meta": { "title": "NAGCFGGuider" } },
  "197": { "inputs": { "noise": ["200", 0], "guider": ["196", 0], "sampler": ["202", 0], "sigmas": ["204", 0], "latent_image": ["124", 0] }, "class_type": "SamplerCustomAdvanced", "_meta": { "title": "SamplerCustomAdvanced" } },
  "198": { "inputs": { "conditioning": ["250", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "200": { "inputs": { "noise_seed": 315883858628164 }, "class_type": "RandomNoise", "_meta": { "title": "RandomNoise" } },
  "202": { "inputs": { "sampler_name": "euler" }, "class_type": "KSamplerSelect", "_meta": { "title": "KSamplerSelect" } },
  "204": { "inputs": { "scheduler": "simple", "steps": 20, "denoise": 0.8500000000000002, "model": ["37", 0] }, "class_type": "BasicScheduler", "_meta": { "title": "BasicScheduler" } },
  "212": { "inputs": { "lora_name": "42lux-UltimateAtHome-flux-highresfix%20(1).safetensors", "strength_model": 0.12000000000000002, "strength_clip": 0.12000000000000002, "model": ["37", 0], "clip": ["38", 0] }, "class_type": "LoraLoader", "_meta": { "title": "Load LoRA" } },
  "213": { "inputs": { "filename_prefix": "ComfyUI", "images": ["254", 0] }, "class_type": "SaveImage", "_meta": { "title": "Output_BackUP-version" } },
  "214": { "inputs": { "image": "ComfyUI_00110_.png" }, "class_type": "LoadImage", "_meta": { "title": "Original_Image" } },
  "215": { "inputs": { "image": "ComfyUI_00111_.png" }, "class_type": "LoadImage", "_meta": { "title": "Pose_image" } },
  "229": { "inputs": { "select": ["230", 0], "images1": ["214", 0], "images2_opt": ["215", 0] }, "class_type": "ImageMaskSwitch", "_meta": { "title": "Switch (images, mask)" } },
  "230": { "inputs": { "Number": "1" }, "class_type": "Int", "_meta": { "title": "Switch with reference (2) or not (1) PROMPT" } },
  "232": { "inputs": { "select": ["230", 0], "sel_mode": false, "input1": ["193", 0], "input2": ["193", 0] }, "class_type": "ImpactSwitch", "_meta": { "title": "Switch (Any)" } },
  "250": { "inputs": { "text": "", "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "254": { "inputs": { "samples": ["197", 0], "vae": ["39", 0] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } }
}`;

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

async function downloadFromSupabase(supabase: any, publicUrl: string) {
  const { bucket, path } = parseStorageURL(publicUrl);
  const { data, error } = await supabase.storage.from(bucket).download(path);
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

function extractJson(text: string) {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match && match[1]) return JSON.parse(match[1]);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("The model returned a response that could not be parsed as JSON.");
  }
}

function getDenoiseValue(pose: any): number {
    const count = pose.retry_count || 0;
    const type = pose.last_retry_type;

    if (count >= 2 && type === 'manual') {
        return 0.92;
    }
    
    if (count === 1 && type === 'manual') {
        return 0.88;
    }

    return 0.85;
}

serve(async (req) => {
  const requestId = `pose-generator-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
      }
    });
  }
  if (!COMFYUI_ENDPOINT_URL) throw new Error("COMFYUI_ENDPOINT_URL is not set.");
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");
  try {
    const body = await req.json();
    console.log(`[PoseGenerator][${requestId}] INFO: Received request body:`, JSON.stringify(body));
    const { base_model_url, pose_prompt, pose_image_url, job_id } = body;
    if (!base_model_url || !pose_prompt || !job_id) {
      throw new Error("base_model_url, pose_prompt, and job_id are required.");
    }
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    
    console.log(`[PoseGenerator][${requestId}] INFO: Step 1: Fetching job data...`);
    const { data: job, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('metadata, final_posed_images').eq('id', job_id).single();
    if (fetchError) throw fetchError;
    
    const identityPassport = job.metadata?.identity_passport;
    const currentPose = (job.final_posed_images || []).find((p: any) => p.pose_prompt === pose_prompt);
    if (!currentPose) {
        throw new Error(`Could not find pose with prompt "${pose_prompt}" in job ${job_id}.`);
    }

    console.log(`[PoseGenerator][${requestId}] INFO: Step 2: Classifying user intent...`);
    const triageResult = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite-preview-06-17",
      contents: [{ role: 'user', parts: [{ text: pose_prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
      config: { systemInstruction: { role: "system", parts: [{ text: TRIAGE_SYSTEM_PROMPT }] } }
    });
    const { task_type, garment_description } = extractJson(triageResult.text);
    console.log(`[PoseGenerator][${requestId}] INFO: Intent classified as: '${task_type}'. Garment: '${garment_description || 'N/A'}'`);
    
    let finalWorkflowString;
    let selectedSystemPrompt;
    let baseEditingTask;
    if (task_type === 'both') {
      finalWorkflowString = twoPassWorkflowTemplate;
      selectedSystemPrompt = POSE_CHANGE_SYSTEM_PROMPT;
      baseEditingTask = pose_prompt;
    } else {
      finalWorkflowString = singlePassWorkflowTemplate;
      if (task_type === 'garment') {
        selectedSystemPrompt = GARMENT_SWAP_SYSTEM_PROMPT;
        baseEditingTask = `change their garment to match my reference (it being a prompt or a textual prompt), keep everything else the same - do nto add unrequested additions otuside the only excplicit garment requested - ex. frontale veste una giacca - still just asks for a jacket so no pants or shoes are being asked for so you'll need to specify in the istruction to NOT change the underware as it is, DO NOT TRY TO FINISH OUTFITS OR CLOTHING SETS, DO NOT - JUST DESCRIBE THE SWAP TO ADD ESCLUSIVELY THE REQUESTED GARMENT AND LEAVIN THE REST UNTOUCHED - AND REMEMBER TO CLARIFY THAT COLOR CORRECTION, COLOR OF THE SKIN, COLOR OF THE scene HAVE TO CONTINUE BEING THE SMAE AS THE ORIGINAL - here the reference requested that has to be completely inserted realsitically in the scene (if you ask to change the bra for another upper body garment remeber it must be closed not opened (the garment) and you have to explain instead of the bra and telling it what body area would it cover (a jacket would not just cover the area a bra would), just request the addition:: ${garment_description}`;
      } else {
        selectedSystemPrompt = POSE_CHANGE_SYSTEM_PROMPT;
        baseEditingTask = pose_prompt;
      }
    }
    let enrichedEditingTask = `User Request: "${baseEditingTask}"`;
    if (identityPassport) {
      const passportText = `Identity Constraints: The model MUST have ${identityPassport.skin_tone}, ${identityPassport.hair_style}, and ${identityPassport.eye_color}. These features must be preserved perfectly.`;
      enrichedEditingTask = `${passportText}\n\n${enrichedEditingTask}`;
      console.log(`[PoseGenerator][${requestId}] INFO: Identity Passport injected into prompt context.`);
    }
    console.log(`[PoseGenerator][${requestId}] INFO: Workflow selected. Type: ${task_type}. Final Editing Task: "${enrichedEditingTask}"`);
    const finalWorkflow = JSON.parse(finalWorkflowString);

    const denoiseValue = getDenoiseValue(currentPose);
    console.log(`[PoseGenerator][${requestId}] INFO: Dynamic Denoise calculated. Retry Count: ${currentPose.retry_count || 0}, Type: ${currentPose.last_retry_type || 'N/A'}. Final Denoise: ${denoiseValue}`);
    finalWorkflow['204'].inputs.denoise = denoiseValue;
    if (finalWorkflow['271']) {
        finalWorkflow['271'].inputs.denoise = denoiseValue + 0.05; // Keep 2nd pass slightly higher
    }

    console.log(`[PoseGenerator][${requestId}] INFO: Step 4: Logging prompt context to database...`);
    const updatedPoses = (job.final_posed_images || []).map((pose: any) => {
      if (pose.pose_prompt === pose_prompt) {
        return { ...pose, prompt_context_for_gemini: enrichedEditingTask };
      }
      return pose;
    });
    const { error: logError } = await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoses }).eq('id', job_id);
    if (logError) {
      console.warn(`[PoseGenerator][${requestId}] WARNING: Failed to log prompt context: ${logError.message}`);
    } else {
      console.log(`[PoseGenerator][${requestId}] INFO: Prompt context logged successfully.`);
    }

    console.log(`[PoseGenerator][${requestId}] INFO: Step 5: Downloading and uploading assets...`);
    const baseModelBlob = await downloadFromSupabase(supabase, base_model_url);
    const uniqueBaseModelFilename = `base_model_${requestId}.png`;
    const baseModelFilename = await uploadToComfyUI(sanitizedAddress, baseModelBlob, uniqueBaseModelFilename);
    console.log(`[PoseGenerator][${requestId}] INFO: Base model uploaded to ComfyUI as: ${baseModelFilename}`);
    finalWorkflow['214'].inputs.image = baseModelFilename;
    finalWorkflow['195'].inputs.String = selectedSystemPrompt;
    if (pose_image_url) {
      console.log(`[PoseGenerator][${requestId}] INFO: Pose reference image provided. Downloading from: ${pose_image_url}`);
      const poseImageBlob = await downloadFromSupabase(supabase, pose_image_url);
      const uniquePoseRefFilename = `pose_ref_${requestId}.png`;
      const poseImageFilename = await uploadToComfyUI(sanitizedAddress, poseImageBlob, uniquePoseRefFilename);
      finalWorkflow['215'].inputs.image = poseImageFilename;
      finalWorkflow['230'].inputs.Number = "2";
      finalWorkflow['193'].inputs.String = enrichedEditingTask;
      console.log(`[PoseGenerator][${requestId}] INFO: Pose reference uploaded as: ${poseImageFilename}.`);
    } else {
      console.log(`[PoseGenerator][${requestId}] INFO: No pose reference image provided. Using text prompt.`);
      finalWorkflow['230'].inputs.Number = "1";
      finalWorkflow['193'].inputs.String = enrichedEditingTask;
    }
    if (task_type === 'both') {
      finalWorkflow['253'].inputs.String = GARMENT_SWAP_SYSTEM_PROMPT;
      finalWorkflow['257'].inputs.String = garment_description || "";
    }
    const queueUrl = `${sanitizedAddress}/prompt`;
    const payload = { prompt: finalWorkflow };
    console.log(`[PoseGenerator][${requestId}] INFO: Step 6: Sending final payload to ComfyUI...`);
    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`ComfyUI server error: ${await response.text()}`);
    const data = await response.json();
    if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");
    const comfyui_prompt_id = data.prompt_id;
    console.log(`[PoseGenerator][${requestId}] INFO: Job queued successfully with prompt_id: ${comfyui_prompt_id}`);
    
    console.log(`[PoseGenerator][${requestId}] INFO: Atomically updating main job ${job_id} with new pose...`);
    const { error: rpcError } = await supabase.rpc('update_pose_with_prompt_id', {
      p_job_id: job_id,
      p_pose_prompt: pose_prompt,
      p_comfyui_id: comfyui_prompt_id
    });
    if (rpcError) {
      throw new Error(`Failed to update job ${job_id} via RPC: ${rpcError.message}`);
    }
    console.log(`[PoseGenerator][${requestId}] INFO: Main job ${job_id} updated successfully via RPC.`);
    return new Response(JSON.stringify({ comfyui_prompt_id: comfyui_prompt_id }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
      },
      status: 200
    });
  } catch (error) {
    console.error(`[PoseGenerator][${requestId}] ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
      },
      status: 500
    });
  }
});