import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const workflowTemplate = `{
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
  "194": { "inputs": { "text_0": "Replace the woman's taupe bra with a classic-fit, crewneck t-shirt made of cotton jersey. The main body of the t-shirt is solid red, and the short sleeves are solid blue. The t-shirt should fit her naturally, conforming to her pose. Her taupe panties must remain completely unchanged and visible below the new t-shirt.\\n\\nIt is absolutely critical to preserve the model's exact pose, including their arm, leg, and head position. She is standing in a full-body shot, angled slightly towards her left, with her left hand placed on her hip and her right arm hanging relaxed at her side. Her head is tilted slightly to her right.\\n\\nYou must lock down and perfectly preserve the model's identity: she is a woman with tanned skin, voluminous wavy shoulder-length blonde hair, dark brown eyes, high cheekbones, and a wide, open-mouthed smile. Her athletic body shape must remain identical.\\n\\nThe background and lighting must be perfectly preserved. Maintain the seamless, solid neutral gray studio backdrop, the slightly lighter gray floor, and the soft, diffused frontal lighting that creates gentle highlights and soft shadows.", "text": ["248", 0] }, "class_type": "ShowText|pysssss", "_meta": { "title": "Show Text 🐍" } },
  "195": { "inputs": { "String": "placeholder_for_system_prompt" }, "class_type": "String", "_meta": { "title": "roleprompt for editing task" } },
  "196": { "inputs": { "cfg": 1, "nag_scale": 7.5, "nag_tau": 2.5, "nag_alpha": 0.25, "nag_sigma_end": 0.75, "model": ["212", 0], "positive": ["35", 0], "negative": ["135", 0], "nag_negative": ["198", 0], "latent_image": ["124", 0] }, "class_type": "NAGCFGGuider", "_meta": { "title": "NAGCFGGuider" } },
  "197": { "inputs": { "noise": ["200", 0], "guider": ["196", 0], "sampler": ["202", 0], "sigmas": ["204", 0], "latent_image": ["124", 0] }, "class_type": "SamplerCustomAdvanced", "_meta": { "title": "SamplerCustomAdvanced" } },
  "198": { "inputs": { "conditioning": ["250", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "200": { "inputs": { "noise_seed": 315883858628164 }, "class_type": "RandomNoise", "_meta": { "title": "RandomNoise" } },
  "202": { "inputs": { "sampler_name": "euler" }, "class_type": "KSamplerSelect", "_meta": { "title": "KSamplerSelect" } },
  "204": { "inputs": { "scheduler": "simple", "steps": 20, "denoise": 0.8500000000000002, "model": ["37", 0] }, "class_type": "BasicScheduler", "_meta": { "title": "BasicScheduler" } },
  "212": { "inputs": { "lora_name": "42lux-UltimateAtHome-flux-highresfix%20(1).safetensors", "strength_model": 0.12000000000000002, "strength_clip": 0.12000000000000002, "model": ["37", 0], "clip": ["38", 0] }, "class_type": "LoraLoader", "_meta": { "title": "Load LoRA" } },
  "213": { "inputs": { "filename_prefix": "ComfyUI", "images": ["273", 0] }, "class_type": "SaveImage", "_meta": { "title": "Output_BackUP-version" } },
  "214": { "inputs": { "image": "ComfyUI_00110_.png" }, "class_type": "LoadImage", "_meta": { "title": "Original_Image" } },
  "215": { "inputs": { "image": "ComfyUI_00111_.png" }, "class_type": "LoadImage", "_meta": { "title": "Pose_image" } },
  "229": { "inputs": { "select": ["230", 0], "images1": ["214", 0], "images2_opt": ["215", 0] }, "class_type": "ImageMaskSwitch", "_meta": { "title": "Switch (images, mask)" } },
  "230": { "inputs": { "Number": "1" }, "class_type": "Int", "_meta": { "title": "Switch with reference (2) or not (1) PROMPT" } },
  "232": { "inputs": { "select": ["230", 0], "sel_mode": false, "input1": ["193", 0], "input2": ["193", 0] }, "class_type": "ImpactSwitch", "_meta": { "title": "Switch (Any)" } },
  "233": { "inputs": { "cfg": 1, "nag_scale": 9.03, "nag_tau": 2.5, "nag_alpha": 0.25, "nag_sigma_end": 0.85, "model": ["212", 0], "positive": ["246", 0], "negative": ["244", 0], "nag_negative": ["242", 0], "latent_image": ["197", 0] }, "class_type": "NAGCFGGuider", "_meta": { "title": "NAGCFGGuider" } },
  "235": { "inputs": { "noise": ["200", 0], "guider": ["233", 0], "sampler": ["202", 0], "sigmas": ["271", 0], "latent_image": ["197", 0] }, "class_type": "SamplerCustomAdvanced", "_meta": { "title": "SamplerCustomAdvanced" } },
  "236": { "inputs": { "samples": ["235", 0], "vae": ["39", 0] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } },
  "242": { "inputs": { "conditioning": ["249", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "243": { "inputs": { "text": ["247", 0], "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "244": { "inputs": { "conditioning": ["249", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "245": { "inputs": { "conditioning": ["243", 0], "latent": ["197", 0] }, "class_type": "ReferenceLatent", "_meta": { "title": "ReferenceLatent" } },
  "246": { "inputs": { "guidance": 3.5, "conditioning": ["245", 0] }, "class_type": "FluxGuidance", "_meta": { "title": "FluxGuidance" } },
  "247": { "inputs": { "value": ["248", 0] }, "class_type": "PrimitiveString", "_meta": { "title": "String" } },
  "248": { "inputs": { "prompt": ["256", 0], "safety_settings": "BLOCK_NONE", "response_type": "text", "model": "gemini-2.5-pro", "api_key": "AIzaSyByuyPAPHMnftan3cvqaZRTTwlGATYinnA", "proxy": "", "system_instruction": ["253", 0], "error_fallback_value": "", "seed": 2015839296, "temperature": 0.7500000000000001, "num_predict": 0, "image_1": ["254", 0] }, "class_type": "Ask_Gemini", "_meta": { "title": "Ask Gemini" } },
  "249": { "inputs": { "text": "", "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "250": { "inputs": { "text": "", "clip": ["212", 1] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Positive Prompt)" } },
  "252": { "inputs": { "String": "change their garment to match my reference (it being a prompt or a textual prompt), keep everything else the same - do nto add unrequested additions otuside the only excplicit garment requested DO NOT TRY TO FINISH OUTFITS OR CLOTHING SETS, DO NOT - JUST DESCRIBE THE SWAP TO ADD ESCLUSIVELY THE REQUESTED GARMENT AND LEAVIN THE REST UNTOUCHED - here the reference requested:" }, "class_type": "String", "_meta": { "title": "editing task" } },
  "253": { "inputs": { "String": "You are an expert prompt engineer for a powerful image-to-image editing model called \\"Kontext\\". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model to **swap a model's clothing while preserving their pose and identity**. The final prompt must be in English and must not exceed 512 tokens.\\n\\n### Core Operating Principles & Methodologies\\n\\n**I. Pose Preservation Mandate (HIGHEST PRIORITY):**\\nYour most critical task is to ensure the model's pose does not change.\\n1.  **Analyze the Pose:** You MUST visually analyze the pose in the SOURCE IMAGE.\\n2.  **Describe the Pose:** In your final prompt, you MUST include a detailed, explicit description of the model's pose (e.g., \\"standing with hands on hips,\\" \\"walking towards the camera,\\" \\"sitting with legs crossed\\").\\n3.  **Lock the Pose:** Your prompt MUST contain a clause like \\"It is absolutely critical to preserve the model's exact pose, including their arm, leg, and head position.\\"\\n\\n**II. Hyper-Detailed Character & Identity LOCKDOWN:**\\nThis is your second most critical task. A simple \\"preserve face\\" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.\\n- **Analyze & Describe:** Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks').\\n- **Embed in Prompt:** Weave these exact descriptions into your preservation clause to leave no room for interpretation.\\n\\n**III. Background & Lighting Preservation:**\\nYou MUST describe the background and lighting from the source image and include a command to preserve them perfectly.\\n\\n**IV. The Creative Task: Garment Swapping**\\n- Your primary creative task is to describe the new garment requested by the user.\\n- Replace the description of the model's current clothing with a hyper-detailed description of the new garment.\\n- If the user provides a reference image for the garment, you must follow the \\"Golden Rule of Reference Image Handling\\": visually analyze the reference, extract its key attributes (color, pattern, texture, fit), and verbally describe those attributes in your prompt. DO NOT say \\"make it look like the reference.\\"\\n\\n### Your Output:\\nYour output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles to construct a single, precise, and explicit instruction. Describe what to change (the garment), but describe what to keep (pose, identity, background, lighting) in even greater detail." }, "class_type": "String", "_meta": { "title": "roleprompt for editing task" } },
  "254": { "inputs": { "samples": ["197", 0], "vae": ["39", 0] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } },
  "256": { "inputs": { "string_a": ["252", 0], "string_b": ["257", 0], "delimiter": "" }, "class_type": "StringConcatenate", "_meta": { "title": "Concatenate" } },
  "257": { "inputs": { "String": "a red and blue tshirt" }, "class_type": "String", "_meta": { "title": "garment request" } },
  "262": { "inputs": { "images": ["254", 0] }, "class_type": "PreviewImage", "_meta": { "title": "Preview Image" } },
  "263": { "inputs": { "text_0": "Replace the woman's taupe bra with a classic-fit, crewneck t-shirt made of cotton jersey. The main body of the t-shirt is solid red, and the short sleeves are solid blue. The t-shirt should fit her naturally, conforming to her pose. Her taupe panties must remain completely unchanged and visible below the new t-shirt.\\n\\nIt is absolutely critical to preserve the model's exact pose, including their arm, leg, and head position. She is standing in a full-body shot, angled slightly towards her left, with her left hand placed on her hip and her right arm hanging relaxed at her side. Her head is tilted slightly to her right.\\n\\nYou must lock down and perfectly preserve the model's identity: she is a woman with tanned skin, voluminous wavy shoulder-length blonde hair, dark brown eyes, high cheekbones, and a wide, open-mouthed smile. Her athletic body shape must remain identical.\\n\\nThe background and lighting must be perfectly preserved. Maintain the seamless, solid neutral gray studio backdrop, the slightly lighter gray floor, and the soft, diffused frontal lighting that creates gentle highlights and soft shadows.", "text": ["248", 0] }, "class_type": "ShowText|pysssss", "_meta": { "title": "Show Text 🐍" } },
  "267": { "inputs": { "method": "hm-mvgd-hm", "strength": 0.30000000000000004, "image_ref": ["214", 0], "image_target": ["236", 0] }, "class_type": "ColorMatch", "_meta": { "title": "Color Match" } },
  "271": { "inputs": { "scheduler": "simple", "steps": 20, "denoise": 0.7500000000000001, "model": ["212", 0] }, "class_type": "BasicScheduler", "_meta": { "title": "BasicScheduler" } },
  "273": { "inputs": { "clamp": true, "gamma": 1, "contrast": 1, "exposure": 0, "offset": 0, "hue": 0, "saturation": 1.1000000000000003, "value": 1, "image": ["267", 0] }, "class_type": "Color Correct (mtb)", "_meta": { "title": "Color Correct (mtb)" } }
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
  if (req.method === 'OPTIONS') { return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } }); }
  if (!COMFYUI_ENDPOINT_URL) throw new Error("COMFYUI_ENDPOINT_URL is not set.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");

  try {
    const body = await req.json();
    console.log(`[PoseGenerator][${requestId}] INFO: Received request body:`, JSON.stringify(body));
    const { job_id, base_model_url, pose_prompt, pose_image_url } = body;
    if (!job_id || !base_model_url || !pose_prompt) {
      throw new Error("job_id, base_model_url and pose_prompt are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    // --- Step 1: Triage the user's request ---
    console.log(`[PoseGenerator][${requestId}] INFO: Step 1: Classifying user intent...`);
    const triageResult = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite-preview-06-17",
        contents: [{ role: 'user', parts: [{ text: pose_prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: TRIAGE_SYSTEM_PROMPT }] } }
    });
    console.warn(`[PoseGenerator][${requestId}] DEBUG: Raw triage response from Gemini:`, triageResult.text);
    const { task_type, garment_description } = extractJson(triageResult.text);
    console.log(`[PoseGenerator][${requestId}] INFO: Intent classified as: '${task_type}'. Garment: '${garment_description || 'N/A'}'`);

    // --- Step 2: Select workflow and configure prompts ---
    let finalWorkflowString: string;
    let selectedSystemPrompt: string;
    let editingTask: string;

    if (task_type === 'both') {
        finalWorkflowString = twoPassWorkflowTemplate;
        selectedSystemPrompt = POSE_CHANGE_SYSTEM_PROMPT; // Pass 1 is always pose
        editingTask = pose_prompt; // Use the full original prompt for the pose pass
    } else {
        finalWorkflowString = singlePassWorkflowTemplate;
        if (task_type === 'garment') {
            selectedSystemPrompt = GARMENT_SWAP_SYSTEM_PROMPT;
            editingTask = `Change the current garment to: ${garment_description}`;
        } else { // 'pose'
            selectedSystemPrompt = POSE_CHANGE_SYSTEM_PROMPT;
            editingTask = pose_prompt;
        }
    }
    console.log(`[PoseGenerator][${requestId}] INFO: Workflow selected. Type: ${task_type}. Editing Task: "${editingTask}"`);

    const finalWorkflow = JSON.parse(finalWorkflowString);

    // --- Step 3: Populate workflow with assets and prompts ---
    console.log(`[PoseGenerator][${requestId}] INFO: Step 3: Downloading base model from: ${base_model_url}`);
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
      finalWorkflow['230'].inputs.Number = "2"; // Use image reference
      finalWorkflow['193'].inputs.String = editingTask; // The task is the same, but the model will see the reference
      console.log(`[PoseGenerator][${requestId}] INFO: Pose reference uploaded as: ${poseImageFilename}.`);
    } else {
      console.log(`[PoseGenerator][${requestId}] INFO: No pose reference image provided. Using text prompt.`);
      finalWorkflow['230'].inputs.Number = "1"; // Use text reference
      finalWorkflow['193'].inputs.String = editingTask;
    }

    if (task_type === 'both') {
        finalWorkflow['253'].inputs.String = GARMENT_SWAP_SYSTEM_PROMPT;
        finalWorkflow['257'].inputs.String = garment_description || "";
    }

    const queueUrl = `${sanitizedAddress}/prompt`;
    const payload = { prompt: finalWorkflow };
    
    console.log(`[PoseGenerator][${requestId}] INFO: Step 4: Sending final payload to ComfyUI...`);
    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`ComfyUI server error: ${await response.text()}`);
    
    const data = await response.json();
    if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");
    const comfyuiPromptId = data.prompt_id;
    console.log(`[PoseGenerator][${requestId}] INFO: Job queued successfully with prompt_id: ${comfyuiPromptId}`);

    // --- Step 5: Save the ID to the database ---
    console.log(`[PoseGenerator][${requestId}] INFO: Step 5: Saving prompt_id to database for job ${job_id}...`);
    const { error: rpcError } = await supabase.rpc('update_pose_with_prompt_id', {
        p_job_id: job_id,
        p_pose_prompt: pose_prompt,
        p_comfyui_id: comfyuiPromptId
    });
    if (rpcError) {
        console.error(`[PoseGenerator][${requestId}] ERROR: Failed to save prompt_id to database:`, rpcError);
        // Don't throw, but log it as a critical failure. The poller will eventually mark it as failed.
    } else {
        console.log(`[PoseGenerator][${requestId}] INFO: Successfully saved prompt_id to database.`);
    }

    return new Response(JSON.stringify({ comfyui_prompt_id: comfyuiPromptId }), {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' },
      status: 200,
    });

  } catch (error) {
    console.error(`[PoseGenerator][${requestId}] ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' },
      status: 500,
    });
  }
});