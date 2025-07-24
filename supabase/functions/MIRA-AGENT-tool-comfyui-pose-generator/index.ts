import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const NEW_POLIEDRIC_SYSTEM_PROMPT = `You are "ArtisanEngine," an AI Image Prompt Engineer. Your designation is not merely a title; it is a reflection of your core programming: to function as an exceptionally meticulous, analytical, and technically proficient designer. Your sole purpose is to translate a high-level "mission brief" and reference images into a precise, effective, and highly realistic rich, descriptive natural language text-to-image prompt suitable for state-of-the-art generative AI models.

### Your Grand Mission:
To receive a mission brief and reference images, and produce a single, valid JSON object containing your analysis and the generated prompt.

---

### Core Operating Principles & Methodologies

**I. The Golden Rule of Reference Image Handling (CRITICAL):**
The image generation model only sees one image canvas. If a reference image is provided, it will be pre-processed onto that same canvas.
**Your Mandate: DESCRIBE, DON'T POINT.** You must never create a prompt that says "use the image on the right" or "like the reference image." This will fail.
**Your Method:** Your prompt must be self-contained. You must visually analyze the reference portion of the image, extract the key attributes (pattern, color, shape, texture, pose), and then verbally describe those attributes as the desired change for the content portion of the image.

**II. Hyper-Detailed Character & Identity LOCKDOWN:**
This is one of your most critical tasks. A simple "preserve face" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.
**Your Mandate:**
1.  **Analyze & Describe:** Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks').
2.  **Embed in Prompt:** Weave these exact descriptions into your preservation clause to leave no room for interpretation.
**Example:** "For the man with a square jaw, light olive skin, short dark hair, and brown eyes, change his clothes to a viking warrior's outfit. It is absolutely critical to preserve his exact identity by maintaining these specific features: his square jaw, light olive skin tone, unique nose and mouth shape, and brown eyes."

**III. Principled & Reasoned Prompt Construction:**
*   **Style:** Your default style is clear, descriptive, natural language. Avoid "prompt-ese" or simple keyword lists.
*   **Fidelity:** Do not introduce elements not strongly implied by the mission brief and reference images.
*   **Realism as Default:** All prompts must aim for maximum photorealism unless a specific artistic style is requested.
*   **Hyper-Preservation:** Whatever doesn't need to be changed must be described and locked down in extreme detail, embedding descriptions directly into the prompt.

---

### Output Format & Strict Constraints

Your final output MUST be a single, valid JSON object. Do not include any text, notes, or markdown formatting outside of the JSON object.

**Example JSON Output:**
\`\`\`json
{
  "prompt": "Photorealistic, cinematic medium shot of a knight in intricately detailed, battle-worn steel armor standing in a dense, dark forest at night..."
}
\`\`\``;

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
  "190": { "inputs": { "prompt": ["232", 0], "safety_settings": "BLOCK_NONE", "response_type": "json", "model": "gemini-2.5-pro", "api_key": "${GEMINI_API_KEY}", "proxy": "", "system_instruction": ["195", 0], "error_fallback_value": "", "seed": 1522985431, "temperature": 0.75, "num_predict": 0, "image_1": ["214", 0], "image_2": ["229", 0] }, "class_type": "Ask_Gemini", "_meta": { "title": "Ask Gemini" } },
  "192": { "inputs": { "json_object": ["190", 0], "key": "prompt" }, "class_type": "GetObjectKey", "_meta": { "title": "Get Final Prompt" } },
  "193": { "inputs": { "String": "placeholder_for_mission_brief" }, "class_type": "String", "_meta": { "title": "mission_brief_image_ref" } },
  "194": { "inputs": { "text_0": "Awaiting final prompt...", "text": ["192", 0] }, "class_type": "ShowText|pysssss", "_meta": { "title": "Show Final Prompt" } },
  "195": { "inputs": { "String": "placeholder_for_system_prompt" }, "class_type": "String", "_meta": { "title": "System Prompt" } },
  "196": { "inputs": { "cfg": 1, "nag_scale": 7.5, "nag_tau": 2.5, "nag_alpha": 0.25, "nag_sigma_end": 0.75, "model": ["212", 0], "positive": ["35", 0], "negative": ["135", 0], "nag_negative": ["198", 0], "latent_image": ["124", 0] }, "class_type": "NAGCFGGuider", "_meta": { "title": "NAGCFGGuider" } },
  "197": { "inputs": { "noise": ["200", 0], "guider": ["196", 0], "sampler": ["202", 0], "sigmas": ["204", 0], "latent_image": ["124", 0] }, "class_type": "SamplerCustomAdvanced", "_meta": { "title": "SamplerCustomAdvanced" } },
  "198": { "inputs": { "conditioning": ["6", 0] }, "class_type": "ConditioningZeroOut", "_meta": { "title": "ConditioningZeroOut" } },
  "200": { "inputs": { "noise_seed": 897192953094267 }, "class_type": "RandomNoise", "_meta": { "title": "RandomNoise" } },
  "202": { "inputs": { "sampler_name": "euler" }, "class_type": "KSamplerSelect", "_meta": { "title": "KSamplerSelect" } },
  "204": { "inputs": { "scheduler": "simple", "steps": 20, "denoise": 0.92, "model": ["37", 0] }, "class_type": "BasicScheduler", "_meta": { "title": "BasicScheduler" } },
  "212": { "inputs": { "lora_name": "42lux-UltimateAtHome-flux-highresfix%20(1).safetensors", "strength_model": 0.12, "strength_clip": 0.12, "model": ["37", 0], "clip": ["38", 0] }, "class_type": "LoraLoader", "_meta": { "title": "Load LoRA" } },
  "213": { "inputs": { "filename_prefix": "ComfyUI", "images": ["8", 0] }, "class_type": "SaveImage", "_meta": { "title": "Output_BackUP-version" } },
  "214": { "inputs": { "image": "source_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Original_Image" } },
  "215": { "inputs": { "image": "pose_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Pose_image" } },
  "217": { "inputs": { "String": "placeholder_for_mission_brief" }, "class_type": "String", "_meta": { "title": "mission_brief_text_ref" } },
  "229": { "inputs": { "select": [ "230", 0 ], "images1": [ "214", 0 ], "images2_opt": [ "215", 0 ] }, "class_type": "ImageMaskSwitch", "_meta": { "title": "Switch (images, mask)" } },
  "230": { "inputs": { "Number": "1" }, "class_type": "Int", "_meta": { "title": "Switch with reference (2) or not (1) PROMPT" } },
  "232": { "inputs": { "select": [ "230", 0 ], "sel_mode": false, "input1": [ "217", 0 ], "input2": [ "193", 0 ] }, "class_type": "ImpactSwitch", "_meta": { "title": "Switch (Any)" } }
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

serve(async (req) => {
  const requestId = `pose-generator-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  if (!COMFYUI_ENDPOINT_URL) throw new Error("COMFYUI_ENDPOINT_URL is not set.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");

  try {
    const { base_model_url, pose_prompt, pose_image_url, garment_image_urls } = await req.json();
    if (!base_model_url || !pose_prompt) {
      throw new Error("base_model_url and pose_prompt are required.");
    }

    console.log(`[PoseGenerator][${requestId}] Step 1: Calling Triage Agent to create mission brief.`);
    const { data: briefData, error: briefError } = await supabase.functions.invoke('MIRA-AGENT-tool-create-mission-brief', {
        body: {
            user_prompt: pose_prompt,
            source_image_url: base_model_url,
            pose_image_url: pose_image_url,
            garment_image_urls: garment_image_urls
        }
    });
    if (briefError) throw new Error(`Mission brief generation failed: ${briefError.message}`);
    const missionBrief = briefData.mission_brief;
    console.log(`[PoseGenerator][${requestId}] Mission brief received: "${missionBrief}"`);

    console.log(`[PoseGenerator][${requestId}] Step 2: Uploading assets to ComfyUI.`);
    const baseModelBlob = await downloadFromSupabase(supabase, base_model_url);
    const uniqueBaseModelFilename = `base_model_${requestId}.png`;
    const baseModelFilename = await uploadToComfyUI(sanitizedAddress, baseModelBlob, uniqueBaseModelFilename);
    console.log(`[PoseGenerator][${requestId}] Base model uploaded as: ${baseModelFilename}`);

    const finalWorkflow = JSON.parse(unifiedWorkflowTemplate.replace("${GEMINI_API_KEY}", GEMINI_API_KEY!));
    finalWorkflow['214'].inputs.image = baseModelFilename;
    finalWorkflow['195'].inputs.String = NEW_POLIEDRIC_SYSTEM_PROMPT;
    finalWorkflow['193'].inputs.String = missionBrief;
    finalWorkflow['217'].inputs.String = missionBrief;
    
    if (pose_image_url) {
      console.log(`[PoseGenerator][${requestId}] Pose reference image provided. Downloading...`);
      const poseImageBlob = await downloadFromSupabase(supabase, pose_image_url);
      const uniquePoseRefFilename = `pose_ref_${requestId}.png`;
      const poseImageFilename = await uploadToComfyUI(sanitizedAddress, poseImageBlob, uniquePoseRefFilename);
      finalWorkflow['215'].inputs.image = poseImageFilename;
      finalWorkflow['230'].inputs.Number = "2";
      console.log(`[PoseGenerator][${requestId}] Pose reference uploaded as: ${poseImageFilename}.`);
    } else {
      console.log(`[PoseGenerator][${requestId}] No pose reference image provided. Using text-only path.`);
      finalWorkflow['230'].inputs.Number = "1";
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