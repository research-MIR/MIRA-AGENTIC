import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const workflowTemplate = `
{
  "9": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader" },
  "10": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader" },
  "20": { "inputs": { "dishonesty_factor": -0.01, "start_percent": 0.66, "end_percent": 0.95, "sampler": ["21", 0] }, "class_type": "LyingSigmaSampler" },
  "21": { "inputs": { "sampler_name": "dpmpp_2m" }, "class_type": "KSamplerSelect" },
  "249": { "inputs": { "lora_name": "IDunnohowtonameLora.safetensors", "strength_model": 0.8, "model": ["304", 0] }, "class_type": "LoraLoaderModelOnly" },
  "304": { "inputs": { "unet_name": "realDream_flux1V1.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader" },
  "307": { "inputs": { "String": "HERE THE PROMPT" }, "class_type": "String" },
  "349": { "inputs": { "clip_l": ["307", 0], "t5xxl": ["307", 0], "guidance": 3.1, "clip": ["9", 0] }, "class_type": "CLIPTextEncodeFlux" },
  "361": { "inputs": { "clip_l": "over exposed,ugly, depth of field ", "t5xxl": "over exposed,ugly, depth of field", "guidance": 3.1, "clip": ["9", 0] }, "class_type": "CLIPTextEncodeFlux" },
  "363": { "inputs": { "lora_name": "Samsung_UltraReal.safetensors", "strength_model": 0.68, "model": ["249", 0] }, "class_type": "LoraLoaderModelOnly" },
  "389": { "inputs": { "filename_prefix": "Output", "images": ["407", 0] }, "class_type": "SaveImage" },
  "402": { "inputs": { "control_net_name": "fluxcontrolnetupscale.safetensors" }, "class_type": "ControlNetLoader" },
  "403": { "inputs": { "strength": 1.0, "start_percent": 0, "end_percent": 1, "positive": ["349", 0], "negative": ["361", 0], "control_net": ["402", 0], "image": ["404", 0], "vae": ["10", 0] }, "class_type": "ControlNetApplyAdvanced" },
  "404": { "inputs": { "image": "placeholder.png" }, "class_type": "LoadImage" },
  "407": { "inputs": { "upscale_by": 1.4, "seed": 576355546919873, "steps": 20, "cfg": 1, "sampler_name": "euler", "scheduler": "normal", "denoise": 0.25, "mode_type": "Linear", "tile_width": 1024, "tile_height": 1024, "mask_blur": 8, "tile_padding": 32, "seam_fix_mode": "None", "seam_fix_denoise": 1, "seam_fix_width": 64, "seam_fix_mask_blur": 8, "seam_fix_padding": 16, "force_uniform_tiles": true, "tiled_decode": false, "image": ["404", 0], "model": ["363", 0], "positive": ["403", 0], "negative": ["403", 1], "vae": ["10", 0], "upscale_model": ["408", 0], "custom_sampler": ["20", 0], "custom_sigmas": ["409", 0] }, "class_type": "UltimateSDUpscaleCustomSample" },
  "408": { "inputs": { "model_name": "4x-UltraSharp.pth" }, "class_type": "UpscaleModelLoader" },
  "409": { "inputs": { "scheduler": "normal", "steps": 20, "denoise": 0.25, "model": ["363", 0] }, "class_type": "BasicScheduler" }
}
`;

async function uploadImageToComfyUI(comfyUiUrl: string, image: File | Blob, filename: string): Promise<string> {
    const uploadFormData = new FormData();
    uploadFormData.append('image', image, filename);
    uploadFormData.append('overwrite', 'true');

    const uploadUrl = `${comfyUiUrl}/upload/image`;
    const response = await fetch(uploadUrl, {
        method: 'POST',
        body: uploadFormData,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ComfyUI upload failed with status ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    if (!data.name) throw new Error("ComfyUI did not return a filename for the uploaded image.");
    return data.name;
}

serve(async (req) => {
  const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
  const requestId = req.headers.get("x-request-id") || `queue-proxy-${Date.now()}`;
  console.log(`[QueueProxy][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!COMFYUI_ENDPOINT_URL) {
    console.error(`[QueueProxy][${requestId}] CRITICAL: COMFYUI_ENDPOINT_URL secret is not set.`);
    return new Response(JSON.stringify({ error: "Server configuration error: COMFYUI_ENDPOINT_URL secret is not set." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");

  try {
    let body;
    let imageFile: File | Blob | null = null;
    let sourceImageUrl: string | null = null;
    const contentType = req.headers.get('content-type');

    if (contentType && contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        body = Object.fromEntries(formData.entries());
        const image = formData.get('image');
        if (image instanceof File) {
            imageFile = image;
            sourceImageUrl = `local_file_${image.name}`;
        }
    } else {
        body = await req.json();
        if (body.image_url) {
            sourceImageUrl = body.image_url;
            const imageResponse = await fetch(body.image_url, {
                headers: { 'Authorization': req.headers.get('Authorization')!, 'apikey': Deno.env.get('SUPABASE_ANON_KEY')! }
            });
            if (!imageResponse.ok) throw new Error(`Failed to download image from URL: ${imageResponse.statusText}`);
            imageFile = await imageResponse.blob();
        }
    }
    
    const { invoker_user_id, upscale_factor, original_prompt_for_gallery, main_agent_job_id, prompt_text } = body;
    if (!invoker_user_id) throw new Error("Missing required parameter: invoker_user_id");
    if (!prompt_text) throw new Error("Missing required parameter: prompt_text");
    if (!imageFile) throw new Error("Missing image data.");

    const uploadedFilename = await uploadImageToComfyUI(sanitizedAddress, imageFile, sourceImageUrl?.split('/').pop() || 'image.png');
    console.log(`[QueueProxy][${requestId}] Successfully uploaded image. Filename: ${uploadedFilename}`);

    const finalWorkflow = JSON.parse(workflowTemplate);
    finalWorkflow['404'].inputs.image = uploadedFilename;
    finalWorkflow['307'].inputs.String = prompt_text;
    const randomSeed = Math.floor(Math.random() * 1000000000000000);
    finalWorkflow['407'].inputs.seed = randomSeed;
    if (upscale_factor) {
        finalWorkflow['407'].inputs.upscale_by = parseFloat(upscale_factor);
    }

    const queueUrl = `${sanitizedAddress}/prompt`;
    const payload = { prompt: finalWorkflow };
    console.log(`[QueueProxy][${requestId}] Sending prompt to: ${queueUrl}`);

    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ComfyUI server responded with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");

    const { data: newJob, error: insertError } = await supabase
        .from('mira-agent-comfyui-jobs')
        .insert({
            user_id: invoker_user_id,
            comfyui_address: sanitizedAddress,
            comfyui_prompt_id: data.prompt_id,
            status: 'queued',
            main_agent_job_id: main_agent_job_id,
            metadata: {
                original_prompt_for_gallery: original_prompt_for_gallery || `Refined: ${prompt_text?.slice(0, 40) || 'image'}...`,
                invoker_user_id: invoker_user_id,
                source_image_url: sourceImageUrl
            }
        })
        .select('id')
        .single();

    if (insertError) throw insertError;

    supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id: newJob.id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[QueueProxy][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});