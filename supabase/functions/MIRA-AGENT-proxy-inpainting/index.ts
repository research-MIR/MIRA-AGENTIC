import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const workflowTemplate = `{
  "3": {
    "inputs": {
      "seed": 964164525614180,
      "steps": 20,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1,
      "model": [
        "58",
        0
      ],
      "positive": [
        "38",
        0
      ],
      "negative": [
        "38",
        1
      ],
      "latent_image": [
        "38",
        2
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "KSampler"
    }
  },
  "7": {
    "inputs": {
      "text": "",
      "clip": [
        "34",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Negative Prompt)"
    }
  },
  "8": {
    "inputs": {
      "samples": [
        "3",
        0
      ],
      "vae": [
        "32",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE Decode"
    }
  },
  "9": {
    "inputs": {
      "filename_prefix": "ComfyUI_Inpaint",
      "images": [
        "66",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Save Image"
    }
  },
  "17": {
    "inputs": {
      "image": "6e53e41b-409c-4055-b8b6-f628b72f5bef.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Input Image"
    }
  },
  "23": {
    "inputs": {
      "text": "short  pink ordered hair",
      "clip": [
        "34",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "PROMPT"
    }
  },
  "26": {
    "inputs": {
      "guidance": 30,
      "conditioning": [
        "23",
        0
      ]
    },
    "class_type": "FluxGuidance",
    "_meta": {
      "title": "FluxGuidance"
    }
  },
  "31": {
    "inputs": {
      "unet_name": "fluxfill.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "Load Diffusion Model"
    }
  },
  "32": {
    "inputs": {
      "vae_name": "ae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "Load VAE"
    }
  },
  "34": {
    "inputs": {
      "clip_name1": "clip_l.safetensors",
      "clip_name2": "t5xxl_fp16.safetensors",
      "type": "flux",
      "device": "default"
    },
    "class_type": "DualCLIPLoader",
    "_meta": {
      "title": "DualCLIPLoader"
    }
  },
  "38": {
    "inputs": {
      "noise_mask": true,
      "positive": [
        "26",
        0
      ],
      "negative": [
        "7",
        0
      ],
      "vae": [
        "32",
        0
      ],
      "pixels": [
        "60",
        0
      ],
      "mask": [
        "53",
        0
      ]
    },
    "class_type": "InpaintModelConditioning",
    "_meta": {
      "title": "InpaintModelConditioning"
    }
  },
  "45": {
    "inputs": {
      "image": "clipspace/clipspace-mask-7067741.png [input]"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Input Mask"
    }
  },
  "47": {
    "inputs": {
      "channel": "red",
      "image": [
        "64",
        0
      ]
    },
    "class_type": "ImageToMask",
    "_meta": {
      "title": "Convert Image to Mask"
    }
  },
  "53": {
    "inputs": {
      "expand": 26,
      "incremental_expandrate": 0,
      "tapered_corners": true,
      "flip_input": false,
      "blur_radius": 5.9,
      "lerp_alpha": 1,
      "decay_factor": 1,
      "fill_holes": false,
      "mask": [
        "47",
        0
      ]
    },
    "class_type": "GrowMaskWithBlur",
    "_meta": {
      "title": "Grow Mask With Blur"
    }
  },
  "55": {
    "inputs": {
      "mask": [
        "53",
        0
      ]
    },
    "class_type": "MaskToImage",
    "_meta": {
      "title": "Convert Mask to Image"
    }
  },
  "56": {
    "inputs": {
      "images": [
        "55",
        0
      ]
    },
    "class_type": "PreviewImage",
    "_meta": {
      "title": "MASKDEBUG"
    }
  },
  "58": {
    "inputs": {
      "multiplier": 1.0010000000000003,
      "model": [
        "31",
        0
      ],
      "samples": [
        "59",
        0
      ],
      "mask": [
        "47",
        0
      ]
    },
    "class_type": "DifferentialDiffusionAdvanced",
    "_meta": {
      "title": "Differential Diffusion Advanced"
    }
  },
  "59": {
    "inputs": {
      "pixels": [
        "62",
        0
      ],
      "vae": [
        "32",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE Encode"
    }
  },
  "60": {
    "inputs": {
      "samples": [
        "58",
        1
      ],
      "vae": [
        "32",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE Decode"
    }
  },
  "62": {
    "inputs": {
      "upscale_model": [
        "63",
        0
      ],
      "image": [
        "17",
        0
      ]
    },
    "class_type": "ImageUpscaleWithModel",
    "_meta": {
      "title": "Upscale Image (using Model)"
    }
  },
  "63": {
    "inputs": {
      "model_name": "4x-UltraSharp.pth"
    },
    "class_type": "UpscaleModelLoader",
    "_meta": {
      "title": "Load Upscale Model"
    }
  },
  "64": {
    "inputs": {
      "upscale_model": [
        "65",
        0
      ],
      "image": [
        "45",
        0
      ]
    },
    "class_type": "ImageUpscaleWithModel",
    "_meta": {
      "title": "Upscale Image (using Model)"
    }
  },
  "65": {
    "inputs": {
      "model_name": "4x-UltraSharp.pth"
    },
    "class_type": "UpscaleModelLoader",
    "_meta": {
      "title": "Load Upscale Model"
    }
  },
  "66": {
    "inputs": {
      "upscale_method": "lanczos",
      "scale_by": 0.25000000000000006,
      "image": [
        "8",
        0
      ]
    },
    "class_type": "ImageScaleBy",
    "_meta": {
      "title": "Upscale Image By"
    }
  },
  "68": {
    "inputs": {
      "images": [
        "64",
        0
      ]
    },
    "class_type": "PreviewImage",
    "_meta": {
      "title": "Preview Image"
    }
  }
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
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!COMFYUI_ENDPOINT_URL) throw new Error("COMFYUI_ENDPOINT_URL is not set.");

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");

  try {
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
      num_attempts = 1,
    } = await req.json();

    if (!user_id || !source_image_base64 || !mask_image_base64) {
      throw new Error("Missing required parameters: user_id, source_image_base64, and mask_image_base64 are required.");
    }

    let finalPrompt = prompt;
    if (!finalPrompt || finalPrompt.trim() === "") {
        if (!reference_image_base64) {
            throw new Error("A text prompt is required when no reference image is provided.");
        }
        console.log(`[InpaintingProxy] No prompt provided. Auto-generating from reference...`);
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

    const fullSourceImage = await loadImage(`data:image/png;base64,${source_image_base64}`);
    const rawMaskImage = await loadImage(`data:image/png;base64,${mask_image_base64}`);

    const dilatedCanvas = createCanvas(rawMaskImage.width(), rawMaskImage.height());
    const dilateCtx = dilatedCanvas.getContext('2d');
    const dilationAmount = Math.max(10, Math.round(rawMaskImage.width() * (mask_expansion_percent / 100)));
    dilateCtx.filter = `blur(${dilationAmount}px)`;
    dilateCtx.drawImage(rawMaskImage, 0, 0);
    dilateCtx.filter = 'none';
    
    const dilatedImageData = dilateCtx.getImageData(0, 0, dilatedCanvas.width, dilatedCanvas.height);
    const imageData = dilatedImageData.data;
    let minX = dilatedCanvas.width, minY = dilatedCanvas.height, maxX = 0, maxY = 0;
    for (let i = 0; i < imageData.length; i += 4) {
      if (imageData[i] > 128) {
        imageData[i] = imageData[i+1] = imageData[i+2] = 255;
        const x = (i / 4) % dilatedCanvas.width;
        const y = Math.floor((i / 4) / dilatedCanvas.width);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      } else {
        imageData[i] = imageData[i+1] = imageData[i+2] = 0;
      }
    }
    dilateCtx.putImageData(dilatedImageData, 0, 0);

    if (maxX < minX || maxY < minY) throw new Error("The provided mask is empty or invalid after processing.");

    const padding = Math.round(Math.max(maxX - minX, maxY - minY) * 0.30);
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

    const sourceToSendBase64 = croppedSourceBase64;
    const maskToSendBase64 = croppedDilatedMaskBase64;

    const sourceBlob = new Blob([decodeBase64(sourceToSendBase64)], { type: 'image/png' });
    const maskBlob = new Blob([decodeBase64(maskToSendBase64)], { type: 'image/png' });
    
    const sourceImageUrl = await uploadToSupabaseStorage(supabase, sourceBlob, user_id, 'source.png');
    let referenceImageUrl: string | null = null;
    if (reference_image_base64) {
        const referenceBlob = new Blob([decodeBase64(reference_image_base64)], { type: 'image/png' });
        referenceImageUrl = await uploadToSupabaseStorage(supabase, referenceBlob, user_id, 'reference.png');
    }
    
    const [sourceFilename, maskFilename] = await Promise.all([
      uploadImageToComfyUI(sanitizedAddress, sourceBlob, 'source.png'),
      uploadImageToComfyUI(sanitizedAddress, maskBlob, 'mask.png')
    ]);

    const jobIds: string[] = [];
    for (let i = 0; i < num_attempts; i++) {
      const finalWorkflow = JSON.parse(workflowTemplate);
      finalWorkflow['17'].inputs.image = sourceFilename;
      finalWorkflow['45'].inputs.image = maskFilename;
      finalWorkflow['23'].inputs.text = finalPrompt;
      finalWorkflow['3'].inputs.seed = Math.floor(Math.random() * 1000000000000000);
      if (denoise) finalWorkflow['3'].inputs.denoise = denoise;

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
          prompt: finalPrompt, 
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
      jobIds.push(newJob.id);
    }

    jobIds.forEach(jobId => {
      supabase.functions.invoke('MIRA-AGENT-poller-inpainting', { body: { job_id: jobId } }).catch(console.error);
    });

    return new Response(JSON.stringify({ success: true, jobIds }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error("[InpaintingProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});