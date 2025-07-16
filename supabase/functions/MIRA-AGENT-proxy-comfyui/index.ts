import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const tiledUpscalerWorkflow = `{
  "10": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader" },
  "48": { "inputs": { "clip_l": "", "t5xxl": "", "guidance": 2, "clip": ["298", 0] }, "class_type": "CLIPTextEncodeFlux" },
  "49": { "inputs": { "conditioning": ["48", 0] }, "class_type": "ConditioningZeroOut" },
  "87": { "inputs": { "text": ["171", 2], "clip": ["298", 0] }, "class_type": "CLIPTextEncode" },
  "88": { "inputs": { "guidance": 3.5, "conditioning": ["87", 0] }, "class_type": "FluxGuidance" },
  "89": { "inputs": { "max_shift": 1.15, "base_shift": 0.5, "width": 1024, "height": 1024, "model": ["304", 0] }, "class_type": "ModelSamplingFlux" },
  "91": { "inputs": { "strength": 0.85, "start_percent": 0, "end_percent": 0.85, "positive": ["88", 0], "negative": ["49", 0], "control_net": ["93", 0], "image": ["152", 0], "vae": ["10", 0] }, "class_type": "ControlNetApplyAdvanced" },
  "93": { "inputs": { "control_net_name": "fluxcontrolnetupscale.safetensors" }, "class_type": "ControlNetLoader" },
  "96": { "inputs": { "upscale_method": "bicubic", "scale_by": ["316", 0], "image": ["148", 0] }, "class_type": "ImageScaleBy" },
  "115": { "inputs": { "seed": 622487950833006, "steps": 20, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": ["317", 0], "model": ["259", 0], "positive": ["91", 0], "negative": ["91", 1], "latent_image": ["118", 0] }, "class_type": "KSampler" },
  "116": { "inputs": { "pixels": ["152", 0], "vae": ["10", 0] }, "class_type": "VAEEncode" },
  "118": { "inputs": { "samples": ["116", 0], "mask": ["152", 1] }, "class_type": "SetLatentNoiseMask" },
  "140": { "inputs": { "blend": 128, "images": ["158", 0], "tile_calc": ["150", 1] }, "class_type": "DynamicTileMerge" },
  "142": { "inputs": { "samples": ["115", 0], "vae": ["10", 0] }, "class_type": "VAEDecode" },
  "148": { "inputs": { "image": ["160", 0], "alpha": ["178", 0] }, "class_type": "JoinImageWithAlpha" },
  "149": { "inputs": { "image": "placeholder.png" }, "class_type": "LoadImage" },
  "150": { "inputs": { "tile_width": 1024, "tile_height": 1024, "overlap": 264, "offset": 0, "image": ["275", 0] }, "class_type": "DynamicTileSplit" },
  "151": { "inputs": { "image": ["150", 0] }, "class_type": "ImpactImageBatchToImageList" },
  "152": { "inputs": { "image": ["151", 0] }, "class_type": "SplitImageWithAlpha" },
  "158": { "inputs": { "images": ["142", 0] }, "class_type": "ImageListToImageBatch" },
  "160": { "inputs": { "upscale_model": ["161", 0], "image": ["204", 0] }, "class_type": "ImageUpscaleWithModel" },
  "161": { "inputs": { "model_name": "4x-UltraSharpV2.safetensors" }, "class_type": "UpscaleModelLoader" },
  "171": { "inputs": { "text_input": "", "task": "prompt_gen_mixed_caption_plus", "fill_mask": true, "keep_model_loaded": true, "max_new_tokens": 1024, "num_beams": 3, "do_sample": true, "output_mask_select": "", "seed": 1116563907150578, "image": ["152", 0], "florence2_model": ["290", 0] }, "class_type": "Florence2Run" },
  "178": { "inputs": { "channel": "red", "image": ["179", 0] }, "class_type": "ImageToMask" },
  "179": { "inputs": { "upscale_method": "nearest-exact", "scale_by": 4.0, "image": ["236", 0] }, "class_type": "ImageScaleBy" },
  "190": { "inputs": { "padding": 16, "constraints": "ignore", "constraint_x": ["219", 0], "constraint_y": ["219", 1], "min_width": 0, "min_height": 0, "batch_behavior": "match_ratio", "mask": ["322", 0] }, "class_type": "Mask To Region" },
  "192": { "inputs": { "force_resize_width": 0, "force_resize_height": 0, "image": ["149", 0], "mask": ["190", 0] }, "class_type": "Cut By Mask" },
  "204": { "inputs": { "kind": "RGB", "image": ["192", 0] }, "class_type": "Change Channel Count" },
  "219": { "inputs": { "image": ["322", 0] }, "class_type": "Get Image Size" },
  "234": { "inputs": { "method": "intensity", "image": ["236", 0] }, "class_type": "Image To Mask" },
  "236": { "inputs": { "force_resize_width": 0, "force_resize_height": 0, "image": ["322", 0], "mask": ["190", 0] }, "class_type": "Cut By Mask" },
  "259": { "inputs": { "use_zero_init": true, "zero_init_steps": 0, "model": ["89", 0] }, "class_type": "CFGZeroStarAndInit" },
  "275": { "inputs": { "select": 1, "sel_mode": false, "input1": ["96", 0] }, "class_type": "ImpactSwitch" },
  "283": { "inputs": { "filename_prefix": "upscaled", "images": ["140", 0] }, "class_type": "SaveImage" },
  "290": { "inputs": { "model": "MiaoshouAI/Florence-2-large-PromptGen-v2.0", "precision": "fp16", "attention": "flash_attention_2", "convert_to_safetensors": false }, "class_type": "DownloadAndLoadFlorence2Model" },
  "297": { "inputs": { "unet_name": "flux1-dev.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader" },
  "298": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader" },
  "299": { "inputs": { "double_layers": "10", "single_layers": "3,4", "scale": 3, "start_percent": 0.01, "end_percent": 0.15, "rescaling_scale": 0, "model": ["297", 0] }, "class_type": "SkipLayerGuidanceDiT" },
  "300": { "inputs": { "lora_name": "42lux-UltimateAtHome-flux-highresfix.safetensors", "strength_model": 0.98, "model": ["299", 0] }, "class_type": "LoraLoaderModelOnly" },
  "301": { "inputs": { "lora_name": "Samsung_UltraReal.safetensors", "strength_model": 0.6, "model": ["300", 0] }, "class_type": "LoraLoaderModelOnly" },
  "302": { "inputs": { "lora_name": "IDunnohowtonameLora.safetensors", "strength_model": 0.5, "model": ["301", 0] }, "class_type": "LoraLoaderModelOnly" },
  "303": { "inputs": { "model": ["302", 0] }, "class_type": "ConfigureModifiedFlux" },
  "304": { "inputs": { "scale": 1.75, "rescale": 0, "model": ["303", 0] }, "class_type": "PAGAttention" },
  "316": { "inputs": { "value": 0.5 }, "class_type": "PrimitiveFloat" },
  "317": { "inputs": { "value": 0.4 }, "class_type": "PrimitiveFloat" },
  "318": { "inputs": { "value": 1, "width": ["319", 0], "height": ["319", 1] }, "class_type": "SolidMask" },
  "319": { "inputs": { "image": ["149", 0] }, "class_type": "Get Image Size" },
  "322": { "inputs": { "mask": ["318", 0] }, "class_type": "MaskToImage" }
}`;

async function uploadImageToComfyUI(comfyUiUrl: string, image: Blob, filename: string) {
  const uploadFormData = new FormData();
  uploadFormData.append('image', image, filename);
  uploadFormData.append('overwrite', 'true');
  const uploadUrl = `${comfyUiUrl}/upload/image`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: uploadFormData
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ComfyUI upload failed with status ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  if (!data.name) throw new Error("ComfyUI did not return a filename for the uploaded image.");
  return data.name;
}

serve(async (req)=>{
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
    const body = await req.json();
    const { invoker_user_id, upscale_factor, denoise, main_agent_job_id, image_url, base64_image_data, mime_type } = body;

    if (!invoker_user_id) throw new Error("Missing required parameter: invoker_user_id");
    if (!image_url && !base64_image_data) throw new Error("Missing image data: provide either image_url or base64_image_data.");

    let imageFile: Blob;
    let originalFilename = 'image.png';

    if (image_url) {
        const imageResponse = await fetch(image_url);
        if (!imageResponse.ok) throw new Error(`Failed to download image from URL: ${imageResponse.statusText}`);
        imageFile = await imageResponse.blob();
        originalFilename = image_url.split('/').pop() || 'image.png';
    } else {
        const imageBuffer = decodeBase64(base64_image_data);
        imageFile = new Blob([imageBuffer], { type: mime_type || 'image/png' });
        originalFilename = 'agent_history_image.png';
    }

    const storagePath = `${invoker_user_id}/source_${Date.now()}_${originalFilename}`;
    await supabase.storage.from(UPLOAD_BUCKET).upload(storagePath, imageFile, { contentType: imageFile.type, upsert: true });
    const { data: { publicUrl: sourceImageUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(storagePath);
    console.log(`[QueueProxy][${requestId}] Source image uploaded to Supabase Storage: ${sourceImageUrl}`);

    const uploadedFilename = await uploadImageToComfyUI(sanitizedAddress, imageFile, originalFilename);
    console.log(`[QueueProxy][${requestId}] Successfully uploaded image to ComfyUI. Filename: ${uploadedFilename}`);
    
    const finalWorkflow = JSON.parse(tiledUpscalerWorkflow);
    finalWorkflow['149'].inputs.image = uploadedFilename;
    
    const secondaryScaleFactor = (upscale_factor || 1.5) / 4.0;
    finalWorkflow['316'].inputs.value = secondaryScaleFactor;
    finalWorkflow['317'].inputs.value = denoise || 0.4;
    finalWorkflow['115'].inputs.seed = Math.floor(Math.random() * 1e15);

    const queueUrl = `${sanitizedAddress}/prompt`;
    const payload = { prompt: finalWorkflow };
    console.log(`[QueueProxy][${requestId}] Sending prompt to: ${queueUrl}`);
    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ComfyUI server responded with status ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");

    const { data: newJob, error: insertError } = await supabase.from('mira-agent-comfyui-jobs').insert({
      user_id: invoker_user_id,
      comfyui_address: sanitizedAddress,
      comfyui_prompt_id: data.prompt_id,
      status: 'queued',
      main_agent_job_id: main_agent_job_id,
      metadata: {
        source: 'refiner',
        source_image_url: sourceImageUrl,
        workflow_payload: payload
      }
    }).select('id').single();
    if (insertError) throw insertError;

    supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id: newJob.id } }).catch(console.error);
    
    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error(`[QueueProxy][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});