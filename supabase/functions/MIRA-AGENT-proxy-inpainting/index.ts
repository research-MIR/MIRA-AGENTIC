import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const workflowTemplate = `{
  "3": { "inputs": { "seed": 1062983749859779, "steps": 20, "cfg": 1, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["39", 0], "positive": ["38", 0], "negative": ["38", 1], "latent_image": ["38", 2] }, "class_type": "KSampler", "_meta": { "title": "KSampler" } },
  "7": { "inputs": { "text": "", "clip": ["34", 0] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Negative Prompt)" } },
  "8": { "inputs": { "samples": ["3", 0], "vae": ["32", 0] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } },
  "9": { "inputs": { "filename_prefix": "ComfyUI_Inpaint", "images": ["54", 0] }, "class_type": "SaveImage", "_meta": { "title": "Save Image" } },
  "17": { "inputs": { "image": "source_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Input Image" } },
  "23": { "inputs": { "text": "Wearing pink Maxi Dress", "clip": ["34", 0] }, "class_type": "CLIPTextEncode", "_meta": { "title": "PROMPT" } },
  "26": { "inputs": { "guidance": 30, "conditioning": ["23", 0] }, "class_type": "FluxGuidance", "_meta": { "title": "FluxGuidance" } },
  "31": { "inputs": { "unet_name": "fluxfill.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader", "_meta": { "title": "Load Diffusion Model" } },
  "32": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader", "_meta": { "title": "Load VAE" } },
  "34": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader", "_meta": { "title": "DualCLIPLoader" } },
  "38": { "inputs": { "noise_mask": false, "positive": ["51", 0], "negative": ["7", 0], "vae": ["32", 0], "pixels": ["17", 0], "mask": ["53", 0] }, "class_type": "InpaintModelConditioning", "_meta": { "title": "InpaintModelConditioning" } },
  "39": { "inputs": { "model": ["31", 0] }, "class_type": "DifferentialDiffusion", "_meta": { "title": "Differential Diffusion" } },
  "45": { "inputs": { "image": "mask_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Input Mask" } },
  "47": { "inputs": { "channel": "red", "image": ["45", 0] }, "class_type": "ImageToMask", "_meta": { "title": "Convert Image to Mask" } },
  "48": { "inputs": { "style_model_name": "fluxcontrolnetupscale.safetensors" }, "class_type": "StyleModelLoader", "_meta": { "title": "Load Style Model" } },
  "49": { "inputs": { "clip_name": "sigclip_vision_patch14_384.safetensors" }, "class_type": "CLIPVisionLoader", "_meta": { "title": "Load CLIP Vision" } },
  "50": { "inputs": { "crop": "none", "clip_vision": ["49", 0], "image": ["52", 0] }, "class_type": "CLIPVisionEncode", "_meta": { "title": "CLIP Vision Encode" } },
  "51": { "inputs": { "strength": 0.30000000000000004, "strength_type": "attn_bias", "conditioning": ["26", 0], "style_model": ["48", 0], "clip_vision_output": ["50", 0] }, "class_type": "StyleModelApply", "_meta": { "title": "Apply Style Model" } },
  "52": { "inputs": { "image": "reference_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Input Reference" } },
  "53": { "inputs": { "expand": 20, "incremental_expandrate": 0, "tapered_corners": true, "flip_input": false, "blur_radius": 3.1, "lerp_alpha": 1, "decay_factor": 1, "fill_holes": false, "mask": ["47", 0] }, "class_type": "GrowMaskWithBlur", "_meta": { "title": "Grow Mask With Blur" } },
  "54": { "inputs": { "method": "mkl", "strength": 0.30000000000000004, "image_ref": ["17", 0], "image_target": ["8", 0] }, "class_type": "ColorMatch", "_meta": { "title": "Color Match" } }
}`;

async function uploadImageToComfyUI(comfyUiUrl: string, imageBlob: Blob, filename: string) {
  const formData = new FormData();
  formData.append('image', imageBlob, filename);
  formData.append('overwrite', 'true');
  const uploadUrl = `${comfyUiUrl}/upload/image`;
  const response = await fetch(uploadUrl, { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`ComfyUI upload failed: ${await response.text()}`);
  const data = await response.json();
  return data.name;
}

async function uploadToSupabaseStorage(supabase: SupabaseClient, blob: Blob, userId: string, filename: string): Promise<string> {
    const filePath = `${userId}/inpainting-sources/${Date.now()}-${filename}`;
    const { error } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, blob, { upsert: true });
    if (error) throw new Error(`Supabase storage upload failed: ${error.message}`);
    const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
    return publicUrl;
}

serve(async (req) => {
  const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
  const requestId = `proxy-inpainting-${Date.now()}`;
  console.log(`[InpaintingProxy][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!COMFYUI_ENDPOINT_URL) throw new Error("COMFYUI_ENDPOINT_URL is not set.");

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json();
    console.log(`[InpaintingProxy][${requestId}] Received full payload:`, JSON.stringify(body, null, 2));

    const {
      user_id,
      source_image_base64,
      mask_image_base64,
      reference_image_base64,
      prompt,
      is_garment_mode,
      denoise,
      style_strength,
      mask_expansion_percent = 2,
    } = body;

    if (!user_id || !source_image_base64 || !mask_image_base64) {
      throw new Error("Missing required parameters: user_id, source_image_base64, and mask_image_base64 are required.");
    }

    let finalPrompt = prompt;
    if (!finalPrompt || finalPrompt.trim() === "") {
        if (!reference_image_base64) {
            throw new Error("A text prompt is required when no reference image is provided.");
        }
        console.log(`[InpaintingProxy][${requestId}] No prompt provided. Auto-generating from reference...`);
        const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
          body: { 
            person_image_base64: source_image_base64,
            person_image_mime_type: 'image/png',
            garment_image_base64: reference_image_base64,
            garment_image_mime_type: 'image/png',
            is_garment_mode: is_garment_mode ?? true
          }
        });
        if (promptError) throw new Error(`Auto-prompt generation failed: ${promptError.message}`);
        finalPrompt = promptData.final_prompt;
        console.log(`[InpaintingProxy][${requestId}] Auto-prompt generated successfully.`);
    }

    if (!finalPrompt) throw new Error("Prompt is required for inpainting.");

    const fullSourceImage = await loadImage(`data:image/png;base64,${source_image_base64}`);
    const rawMaskImage = await loadImage(`data:image/jpeg;base64,${mask_image_base64}`);

    const dilatedCanvas = createCanvas(rawMaskImage.width(), rawMaskImage.height());
    const dilateCtx = dilatedCanvas.getContext('2d');
    const dilationAmount = Math.max(10, Math.round(rawMaskImage.width() * (mask_expansion_percent / 100)));
    dilateCtx.filter = `blur(${dilationAmount}px)`;
    dilateCtx.drawImage(rawMaskImage, 0, 0);
    dilateCtx.filter = 'none';
    
    const dilatedImageData = dilateCtx.getImageData(0, 0, dilatedCanvas.width, dilatedCanvas.height);
    const data = dilatedImageData.data;
    let minX = dilatedCanvas.width, minY = dilatedCanvas.height, maxX = 0, maxY = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 128) {
        data[i] = data[i+1] = data[i+2] = 255;
        const x = (i / 4) % dilatedCanvas.width;
        const y = Math.floor((i / 4) / dilatedCanvas.width);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        data[i] = data[i+1] = data[i+2] = 0;
      }
    }
    dilateCtx.putImageData(dilatedImageData, 0, 0);

    if (maxX < minX || maxY < minY) throw new Error("The provided mask is empty or invalid after processing.");

    const padding = Math.round(Math.max(maxX - minX, maxY - minY) * 0.20);
    const bbox = {
      x: Math.max(0, minX - padding),
      y: Math.max(0, minY - padding),
      width: Math.min(fullSourceImage.width(), maxX + padding) - Math.max(0, minX - padding),
      height: Math.min(fullSourceImage.height(), maxY + padding) - Math.max(0, minY - padding),
    };

    if (bbox.width <= 0 || bbox.height <= 0) throw new Error(`Invalid bounding box dimensions: ${bbox.width}x${bbox.height}.`);

    const croppedCanvas = createCanvas(bbox.width, bbox.height);
    croppedCanvas.getContext('2d').drawImage(fullSourceImage, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
    const croppedSourceBase64 = encodeBase64(croppedCanvas.toBuffer('image/png'));

    const croppedMaskCanvas = createCanvas(bbox.width, bbox.height);
    croppedMaskCanvas.getContext('2d').drawImage(dilatedCanvas, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
    const croppedDilatedMaskBase64 = encodeBase64(croppedMaskCanvas.toBuffer('image/png'));

    let sourceToSendBase64 = croppedSourceBase64;
    let maskToSendBase64 = croppedDilatedMaskBase64;
    const TARGET_LONG_SIDE = 768;
    const cropLongestSide = Math.max(bbox.width, bbox.height);

    if (cropLongestSide < TARGET_LONG_SIDE) {
        const upscaleFactor = TARGET_LONG_SIDE / cropLongestSide;
        const { data: upscaleData, error: upscaleError } = await supabase.functions.invoke('MIRA-AGENT-tool-upscale-crop', {
            body: { source_crop_base64: croppedSourceBase64, mask_crop_base64: croppedDilatedMaskBase64, upscale_factor: upscaleFactor }
        });
        if (upscaleError) throw new Error(`Upscaling failed: ${upscaleError.message}`);
        sourceToSendBase64 = upscaleData.upscaled_source_base64;
        maskToSendBase64 = upscaleData.upscaled_mask_base64;
    }

    const sourceBlob = new Blob([decodeBase64(sourceToSendBase64)], { type: 'image/png' });
    const maskBlob = new Blob([decodeBase64(maskToSendBase64)], { type: 'image/png' });
    
    const sourceImageUrl = await uploadToSupabaseStorage(supabase, sourceBlob, user_id, 'source.png');
    let referenceImageUrl: string | null = null;
    
    const [sourceFilename, maskFilename] = await Promise.all([
      uploadImageToComfyUI(sanitizedAddress, sourceBlob, 'source.png'),
      uploadImageToComfyUI(sanitizedAddress, maskBlob, 'mask.png')
    ]);

    const finalWorkflow = JSON.parse(workflowTemplate);
    finalWorkflow['17'].inputs.image = sourceFilename;
    finalWorkflow['45'].inputs.image = maskFilename;
    finalWorkflow['23'].inputs.text = finalPrompt;
    if (denoise) finalWorkflow['3'].inputs.denoise = denoise;

    if (reference_image_base64) {
        console.log(`[InpaintingProxy][${requestId}] Reference image provided. Using full style model workflow.`);
        const referenceBlob = new Blob([decodeBase64(reference_image_base64)], { type: 'image/png' });
        referenceImageUrl = await uploadToSupabaseStorage(supabase, referenceBlob, user_id, 'reference.png');
        const referenceFilename = await uploadImageToComfyUI(sanitizedAddress, referenceBlob, 'reference.png');
        finalWorkflow['52'].inputs.image = referenceFilename;
        if (style_strength) finalWorkflow['51'].inputs.strength = style_strength;
    } else {
        console.log(`[InpaintingProxy][${requestId}] No reference image. Bypassing style model nodes.`);
        finalWorkflow['38'].inputs.positive = ["26", 0];
    }

    const queueUrl = `${sanitizedAddress}/prompt`;
    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: finalWorkflow })
    });
    if (!response.ok) throw new Error(`ComfyUI server error: ${await response.text()}`);
    
    const comfyUIResponse = await response.json();
    if (!comfyUIResponse.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");

    const { data: newJob, error: insertError } = await supabase.from('mira-agent-inpainting-jobs').insert({
      user_id,
      comfyui_address: sanitizedAddress,
      comfyui_prompt_id: comfyUIResponse.prompt_id,
      status: 'queued',
      metadata: { 
        prompt_used: finalPrompt, 
        denoise, 
        style_strength,
        source_image_url: sourceImageUrl,
        reference_image_url: referenceImageUrl,
        full_source_image_base64: source_image_base64,
        bbox: bbox,
        cropped_dilated_mask_base64: croppedDilatedMaskBase64,
      }
    }).select('id').single();
    if (insertError) throw insertError;

    supabase.functions.invoke('MIRA-AGENT-poller-inpainting', { body: { job_id: newJob.id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[InpaintingProxy][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});