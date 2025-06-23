import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const workflowTemplate = {
  "3": { "inputs": { "seed": 1062983749859779, "steps": 20, "cfg": 1, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["39", 0], "positive": ["38", 0], "negative": ["38", 1], "latent_image": ["38", 2] }, "class_type": "KSampler", "_meta": { "title": "KSampler" } },
  "7": { "inputs": { "text": "", "clip": ["34", 0] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Negative Prompt)" } },
  "8": { "inputs": { "samples": ["3", 0], "vae": ["32", 0] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } },
  "9": { "inputs": { "filename_prefix": "ComfyUI_Inpaint", "images": ["8", 0] }, "class_type": "SaveImage", "_meta": { "title": "Save Image" } },
  "17": { "inputs": { "image": "source_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Input Image" } },
  "23": { "inputs": { "text": "Wearing pink Maxi Dress", "clip": ["34", 0] }, "class_type": "CLIPTextEncode", "_meta": { "title": "PROMPT" } },
  "26": { "inputs": { "guidance": 30, "conditioning": ["23", 0] }, "class_type": "FluxGuidance", "_meta": { "title": "FluxGuidance" } },
  "31": { "inputs": { "unet_name": "fluxfill.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader", "_meta": { "title": "Load Diffusion Model" } },
  "32": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader", "_meta": { "title": "Load VAE" } },
  "34": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader", "_meta": { "title": "DualCLIPLoader" } },
  "38": { "inputs": { "noise_mask": false, "positive": ["51", 0], "negative": ["7", 0], "vae": ["32", 0], "pixels": ["17", 0], "mask": ["47", 0] }, "class_type": "InpaintModelConditioning", "_meta": { "title": "InpaintModelConditioning" } },
  "39": { "inputs": { "model": ["31", 0] }, "class_type": "DifferentialDiffusion", "_meta": { "title": "Differential Diffusion" } },
  "45": { "inputs": { "image": "mask_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Input Mask" } },
  "47": { "inputs": { "channel": "red", "image": ["45", 0] }, "class_type": "ImageToMask", "_meta": { "title": "Convert Image to Mask" } },
  "48": { "inputs": { "style_model_name": "fluxcontrolnetupscale.safetensors" }, "class_type": "StyleModelLoader", "_meta": { "title": "Load Style Model" } },
  "49": { "inputs": { "clip_name": "sigclip_vision_patch14_384.safetensors" }, "class_type": "CLIPVisionLoader", "_meta": { "title": "Load CLIP Vision" } },
  "50": { "inputs": { "crop": "center", "clip_vision": ["49", 0], "image": ["52", 0] }, "class_type": "CLIPVisionEncode", "_meta": { "title": "CLIP Vision Encode" } },
  "51": { "inputs": { "strength": 0.3, "strength_type": "attn_bias", "conditioning": ["26", 0], "style_model": ["48", 0], "clip_vision_output": ["50", 0] }, "class_type": "StyleModelApply", "_meta": { "title": "Apply Style Model" } },
  "52": { "inputs": { "image": "reference_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Input Reference" } }
};

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

serve(async (req) => {
  const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!COMFYUI_ENDPOINT_URL) throw new Error("COMFYUI_ENDPOINT_URL is not set.");

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");

  try {
    const {
      user_id,
      source_image_base64,
      mask_image_base64,
      reference_image_base64, // Optional
      prompt,
      is_garment_mode,
      denoise,
      style_strength
    } = await req.json();

    if (!user_id || !source_image_base64 || !mask_image_base64) {
      throw new Error("Missing required parameters: user_id, source_image_base64, and mask_image_base64 are required.");
    }

    let finalPrompt = prompt;
    if (!finalPrompt || finalPrompt.trim() === "") {
        console.log(`[InpaintingProxy] No prompt provided. Auto-generating...`);
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
        console.log(`[InpaintingProxy] Auto-prompt generated successfully.`);
    }

    if (!finalPrompt) throw new Error("Prompt is required for inpainting.");

    const sourceBlob = new Blob([decodeBase64(source_image_base64)], { type: 'image/png' });
    const maskBlob = new Blob([decodeBase64(mask_image_base64)], { type: 'image/png' });
    
    const [sourceFilename, maskFilename] = await Promise.all([
      uploadImageToComfyUI(sanitizedAddress, sourceBlob, 'source.png'),
      uploadImageToComfyUI(sanitizedAddress, maskBlob, 'mask.png')
    ]);

    const finalWorkflow = JSON.parse(JSON.stringify(workflowTemplate));
    finalWorkflow['17'].inputs.image = sourceFilename;
    finalWorkflow['45'].inputs.image = maskFilename;
    finalWorkflow['23'].inputs.text = finalPrompt;
    if (denoise) finalWorkflow['3'].inputs.denoise = denoise;
    if (style_strength) finalWorkflow['51'].inputs.strength = style_strength;

    if (reference_image_base64) {
      const referenceBlob = new Blob([decodeBase64(reference_image_base64)], { type: 'image/png' });
      const referenceFilename = await uploadImageToComfyUI(sanitizedAddress, referenceBlob, 'reference.png');
      finalWorkflow['52'].inputs.image = referenceFilename;
    } else {
      delete finalWorkflow['38'].inputs.positive;
      finalWorkflow['38'].inputs.positive = ["26", 0];
      delete finalWorkflow['48'];
      delete finalWorkflow['49'];
      delete finalWorkflow['50'];
      delete finalWorkflow['51'];
      delete finalWorkflow['52'];
    }

    const queueUrl = `${sanitizedAddress}/prompt`;
    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: finalWorkflow })
    });
    if (!response.ok) throw new Error(`ComfyUI server error: ${await response.text()}`);
    const data = await response.json();
    if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");

    const { data: newJob, error: insertError } = await supabase.from('mira-agent-inpainting-jobs').insert({
      user_id,
      comfyui_address: sanitizedAddress,
      comfyui_prompt_id: data.prompt_id,
      status: 'queued',
      metadata: { prompt: finalPrompt, denoise, style_strength }
    }).select('id').single();
    if (insertError) throw insertError;

    supabase.functions.invoke('MIRA-AGENT-poller-inpainting', { body: { job_id: newJob.id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error("[InpaintingProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});