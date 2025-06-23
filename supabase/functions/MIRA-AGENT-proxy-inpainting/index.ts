import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const workflowTemplate = `
{
  "3": {
    "inputs": {
      "image": "source_image.png"
    },
    "class_type": "LoadImage",
    "_meta": { "title": "Load Source Image" }
  },
  "4": {
    "inputs": {
      "image": "mask_image.png"
    },
    "class_type": "LoadImage",
    "_meta": { "title": "Load Mask Image" }
  },
  "5": {
    "inputs": {
      "grow": 6,
      "blur": 6,
      "threshold": 0.5,
      "replace_alpha": true,
      "image": [ "4", 0 ]
    },
    "class_type": "ImageToMask",
    "_meta": { "title": "Convert Mask Image to Mask" }
  },
  "6": {
    "inputs": {
      "ckpt_name": "flux1-dev.safetensors"
    },
    "class_type": "CheckpointLoaderSimple",
    "_meta": { "title": "Load Checkpoint" }
  },
  "7": {
    "inputs": {
      "text": "positive prompt here",
      "clip": [ "6", 1 ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "Positive Prompt" }
  },
  "8": {
    "inputs": {
      "text": "negative prompt here",
      "clip": [ "6", 1 ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": { "title": "Negative Prompt" }
  },
  "9": {
    "inputs": {
      "pixels": [ "3", 0 ],
      "vae": [ "6", 2 ]
    },
    "class_type": "VAEEncode",
    "_meta": { "title": "VAE Encode" }
  },
  "10": {
    "inputs": {
      "seed": 12345,
      "steps": 25,
      "cfg": 1.8,
      "sampler_name": "dpmpp_2m_sde",
      "scheduler": "karras",
      "denoise": 1,
      "model": [ "6", 0 ],
      "positive": [ "7", 0 ],
      "negative": [ "8", 0 ],
      "latent_image": [ "9", 0 ]
    },
    "class_type": "KSampler",
    "_meta": { "title": "KSampler" }
  },
  "11": {
    "inputs": {
      "samples": [ "10", 0 ],
      "vae": [ "6", 2 ]
    },
    "class_type": "VAEDecode",
    "_meta": { "title": "VAE Decode" }
  },
  "12": {
    "inputs": {
      "filename_prefix": "ComfyUI_Inpaint",
      "images": [ "11", 0 ]
    },
    "class_type": "SaveImage",
    "_meta": { "title": "Save Image" }
  }
}
`;

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
  if (!COMFYUI_ENDPOINT_URL) {
    return new Response(JSON.stringify({ error: "Server configuration error: COMFYUI_ENDPOINT_URL is not set." }), { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");

  try {
    const {
      user_id,
      source_image_base64,
      mask_image_base64,
      prompt,
      denoise,
    } = await req.json();

    if (!user_id || !source_image_base64 || !mask_image_base64) {
      throw new Error("Missing required parameters.");
    }

    const sourceBlob = new Blob([decodeBase64(source_image_base64)], { type: 'image/png' });
    const maskBlob = new Blob([decodeBase64(mask_image_base64)], { type: 'image/png' });

    const [sourceFilename, maskFilename] = await Promise.all([
      uploadImageToComfyUI(sanitizedAddress, sourceBlob, 'source.png'),
      uploadImageToComfyUI(sanitizedAddress, maskBlob, 'mask.png')
    ]);

    const finalWorkflow = JSON.parse(workflowTemplate);
    finalWorkflow['3'].inputs.image = sourceFilename;
    finalWorkflow['4'].inputs.image = maskFilename;
    finalWorkflow['7'].inputs.text = prompt || "masterpiece, best quality";
    finalWorkflow['8'].inputs.text = "ugly, blurry, deformed";
    finalWorkflow['10'].inputs.seed = Math.floor(Math.random() * 1e15);
    if (denoise) {
      finalWorkflow['10'].inputs.denoise = denoise;
    }

    const queueUrl = `${sanitizedAddress}/prompt`;
    const payload = { prompt: finalWorkflow };
    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`ComfyUI server responded with status ${response.status}: ${await response.text()}`);
    
    const data = await response.json();
    if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");

    const { data: newJob, error: insertError } = await supabase.from('mira-agent-inpainting-jobs').insert({
      user_id,
      comfyui_address: sanitizedAddress,
      comfyui_prompt_id: data.prompt_id,
      status: 'queued',
      metadata: { prompt_used: prompt }
    }).select('id').single();

    if (insertError) throw insertError;

    supabase.functions.invoke('MIRA-AGENT-poller-inpainting', { body: { job_id: newJob.id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), { headers: corsHeaders });

  } catch (error) {
    console.error("[InpaintingProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});