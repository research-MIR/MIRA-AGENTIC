import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

// NOTE: This is the standard, general-purpose upscaling workflow.
const workflowTemplate = `
{
  "9": {
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
  "10": {
    "inputs": {
      "vae_name": "ae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "Load VAE"
    }
  },
  "307": {
    "inputs": {
      "String": "HERE THE PROMPT"
    },
    "class_type": "String",
    "_meta": {
      "title": "Actual Scene Description"
    }
  },
  "349": {
    "inputs": {
      "clip_l": [
        "307",
        0
      ],
      "t5xxl": [
        "307",
        0
      ],
      "guidance": 2.2,
      "clip": [
        "9",
        0
      ]
    },
    "class_type": "CLIPTextEncodeFlux",
    "_meta": {
      "title": "CLIPTextEncodeFlux"
    }
  },
  "361": {
    "inputs": {
      "clip_l": "over exposed,ugly, depth of field ",
      "t5xxl": "over exposed,ugly, depth of field",
      "guidance": 2.5,
      "clip": [
        "9",
        0
      ]
    },
    "class_type": "CLIPTextEncodeFlux",
    "_meta": {
      "title": "CLIPTextEncodeFlux"
    }
  },
  "404": {
    "inputs": {
      "image": "489107a8-dfd4-49f3-a32d-d7699aef2d52.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "InputImage"
    }
  },
  "407": {
    "inputs": {
      "upscale_by": [
        "437",
        1
      ],
      "seed": 82060634998716,
      "steps": 20,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 0.14,
      "mode_type": "Linear",
      "tile_width": 1024,
      "tile_height": 1024,
      "mask_blur": 64,
      "tile_padding": 512,
      "seam_fix_mode": "None",
      "seam_fix_denoise": 0.4000000000000001,
      "seam_fix_width": 0,
      "seam_fix_mask_blur": 8,
      "seam_fix_padding": 16,
      "force_uniform_tiles": true,
      "tiled_decode": false,
      "image": [
        "421",
        0
      ],
      "model": [
        "418",
        0
      ],
      "positive": [
        "349",
        0
      ],
      "negative": [
        "361",
        0
      ],
      "vae": [
        "10",
        0
      ],
      "upscale_model": [
        "408",
        0
      ],
      "custom_sampler": [
        "423",
        0
      ],
      "custom_sigmas": [
        "424",
        0
      ]
    },
    "class_type": "UltimateSDUpscaleCustomSample",
    "_meta": {
      "title": "Ultimate SD Upscale (Custom Sample)"
    }
  },
  "408": {
    "inputs": {
      "model_name": "4xNomosWebPhoto_esrgan.safetensors"
    },
    "class_type": "UpscaleModelLoader",
    "_meta": {
      "title": "Load Upscale Model"
    }
  },
  "410": {
    "inputs": {
      "value": 1.5000000000000004
    },
    "class_type": "FloatConstant",
    "_meta": {
      "title": "Upscale_Scale"
    }
  },
  "412": {
    "inputs": {
      "double_layers": "10",
      "single_layers": "3,4",
      "scale": 3,
      "start_percent": 0.010000000000000002,
      "end_percent": 0.15000000000000002,
      "rescaling_scale": 0,
      "model": [
        "413",
        0
      ]
    },
    "class_type": "SkipLayerGuidanceDiT",
    "_meta": {
      "title": "SkipLayerGuidanceDiT"
    }
  },
  "413": {
    "inputs": {
      "unet_name": "flux1-dev.safetensors",
      "weight_dtype": "fp8_e4m3fn_fast"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "Load Diffusion Model"
    }
  },
  "414": {
    "inputs": {
      "lora_name": "Samsung_UltraReal.safetensors",
      "strength_model": 0.6000000000000001,
      "model": [
        "416",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
    }
  },
  "415": {
    "inputs": {
      "lora_name": "IDunnohowtonameLora.safetensors",
      "strength_model": 0.5000000000000001,
      "model": [
        "414",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
    }
  },
  "416": {
    "inputs": {
      "lora_name": "42lux-UltimateAtHome-flux-highresfix.safetensors",
      "strength_model": 0.9800000000000002,
      "model": [
        "412",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
    }
  },
  "417": {
    "inputs": {
      "model": [
        "415",
        0
      ]
    },
    "class_type": "ConfigureModifiedFlux",
    "_meta": {
      "title": "Configure Modified Flux"
    }
  },
  "418": {
    "inputs": {
      "scale": 1.75,
      "rescale": 0,
      "model": [
        "417",
        0
      ]
    },
    "class_type": "PAGAttention",
    "_meta": {
      "title": "Apply Flux PAG Attention"
    }
  },
  "420": {
    "inputs": {
      "pixels": [
        "404",
        0
      ],
      "vae": [
        "10",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE Encode"
    }
  },
  "421": {
    "inputs": {
      "samples": [
        "420",
        0
      ],
      "vae": [
        "10",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE Decode"
    }
  },
  "422": {
    "inputs": {
      "sampler_name": "dpmpp_2m"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "KSamplerSelect"
    }
  },
  "423": {
    "inputs": {
      "dishonesty_factor": -0.010000000000000002,
      "start_percent": 0.4600000000000001,
      "end_percent": 0.9500000000000002,
      "sampler": [
        "422",
        0
      ]
    },
    "class_type": "LyingSigmaSampler",
    "_meta": {
      "title": "Lying Sigma Sampler"
    }
  },
  "424": {
    "inputs": {
      "scheduler": "sgm_uniform",
      "steps": 10,
      "denoise": 0.14,
      "model": [
        "418",
        0
      ]
    },
    "class_type": "BasicScheduler",
    "_meta": {
      "title": "BasicScheduler"
    }
  },
  "430": {
    "inputs": {
      "images": [
        "445",
        0
      ]
    },
    "class_type": "PreviewImage",
    "_meta": {
      "title": "Preview Image"
    }
  },
  "431": {
    "inputs": {
      "filename_prefix": "Output",
      "images": [
        "445",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Save Image"
    }
  },
  "432": {
    "inputs": {
      "upscale_by": [
        "437",
        1
      ],
      "seed": 839614371047984,
      "steps": 20,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 0.17000000000000004,
      "mode_type": "Linear",
      "tile_width": 1024,
      "tile_height": 1024,
      "mask_blur": 64,
      "tile_padding": 512,
      "seam_fix_mode": "None",
      "seam_fix_denoise": 0.4000000000000001,
      "seam_fix_width": 64,
      "seam_fix_mask_blur": 8,
      "seam_fix_padding": 16,
      "force_uniform_tiles": true,
      "tiled_decode": false,
      "image": [
        "407",
        0
      ],
      "model": [
        "418",
        0
      ],
      "positive": [
        "349",
        0
      ],
      "negative": [
        "361",
        0
      ],
      "vae": [
        "10",
        0
      ],
      "upscale_model": [
        "408",
        0
      ],
      "custom_sampler": [
        "423",
        0
      ],
      "custom_sigmas": [
        "444",
        0
      ]
    },
    "class_type": "UltimateSDUpscaleCustomSample",
    "_meta": {
      "title": "Ultimate SD Upscale (Custom Sample)"
    }
  },
  "437": {
    "inputs": {
      "expression": "a**0.5",
      "a": [
        "410",
        0
      ]
    },
    "class_type": "MathExpression|pysssss",
    "_meta": {
      "title": "Math Expression 🐍"
    }
  },
  "444": {
    "inputs": {
      "scheduler": "sgm_uniform",
      "steps": 10,
      "denoise": 0.25000000000000006,
      "model": [
        "418",
        0
      ]
    },
    "class_type": "BasicScheduler",
    "_meta": {
      "title": "BasicScheduler"
    }
  },
  "445": {
    "inputs": {
      "method": "hm-mvgd-hm",
      "strength": 1.0000000000000002,
      "image_ref": [
        "404",
        0
      ],
      "image_target": [
        "432",
        0
      ]
    },
    "class_type": "ColorMatch",
    "_meta": {
      "title": "Color Match"
    }
  }
}
`;

// NOTE: This is the new, correct skin-specific workflow using LDSR.
const workflowTemplateSkin = `
{
  "3": {
    "inputs": {
      "image": "d0928d10-18cf-451f-8f4a-2c57936c1e59 (1).jpeg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Load Image"
    }
  },
  "4": {
    "inputs": {
      "images": [
        "7",
        0
      ]
    },
    "class_type": "PreviewImage",
    "_meta": {
      "title": "Preview Image"
    }
  },
  "5": {
    "inputs": {
      "model": "last.ckpt"
    },
    "class_type": "LDSRModelLoader",
    "_meta": {
      "title": "Load LDSR Model"
    }
  },
  "6": {
    "inputs": {
      "steps": "50",
      "pre_downscale": "None",
      "post_downscale": "None",
      "downsample_method": "Lanczos",
      "upscale_model": [
        "5",
        0
      ],
      "images": [
        "3",
        0
      ]
    },
    "class_type": "LDSRUpscale",
    "_meta": {
      "title": "LDSR Upscale"
    }
  },
  "7": {
    "inputs": {
      "upscale_method": "nearest-exact",
      "scale_by": [
        "8",
        0
      ],
      "image": [
        "6",
        0
      ]
    },
    "class_type": "ImageScaleBy",
    "_meta": {
      "title": "Upscale Image By"
    }
  },
  "8": {
    "inputs": {
      "Number": "1"
    },
    "class_type": "Float",
    "_meta": {
      "title": "SCALE - CONSIDER THAT LDSR UPSCALE OUTPUTS A X4 OF THE ORIGINAL IMAGE"
    }
  },
  "9": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": [
        "7",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Save Image"
    }
  }
}
`;

async function uploadImageToComfyUI(comfyUiUrl, image, filename) {
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
    return new Response(null, {
      headers: corsHeaders
    });
  }
  if (!COMFYUI_ENDPOINT_URL) {
    console.error(`[QueueProxy][${requestId}] CRITICAL: COMFYUI_ENDPOINT_URL secret is not set.`);
    return new Response(JSON.stringify({
      error: "Server configuration error: COMFYUI_ENDPOINT_URL secret is not set."
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
  const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");
  try {
    let body;
    let imageFile = null;
    let originalFilename = 'image.png';
    let sourceImageUrlForCheck: string | null = null;

    const contentType = req.headers.get('content-type');
    if (contentType && contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
      const image = formData.get('image');
      if (image instanceof File) {
        imageFile = image;
        originalFilename = image.name;
      }
    } else {
      body = await req.json();
      if (body.image_url) {
        sourceImageUrlForCheck = body.image_url;
        const imageResponse = await fetch(body.image_url);
        if (!imageResponse.ok) throw new Error(`Failed to download image from URL: ${imageResponse.statusText}`);
        imageFile = await imageResponse.blob();
        originalFilename = body.image_url.split('/').pop() || 'image.png';
      } else if (body.base64_image_data) {
        const imageBuffer = decodeBase64(body.base64_image_data);
        imageFile = new Blob([
          imageBuffer
        ], {
          type: body.mime_type || 'image/png'
        });
        originalFilename = 'agent_history_image.png';
      }
    }
    const { invoker_user_id, upscale_factor, original_prompt_for_gallery, main_agent_job_id, prompt_text, source, workflow_type } = body;
    if (!invoker_user_id) throw new Error("Missing required parameter: invoker_user_id");
    if (!prompt_text && workflow_type !== 'conservative_skin') throw new Error("Missing required parameter: prompt_text");
    if (!imageFile) throw new Error("Missing image data.");

    // --- Duplicate Job Check ---
    if (sourceImageUrlForCheck) {
        const { data: existingJob, error: checkError } = await supabase
            .from('mira-agent-comfyui-jobs')
            .select('id, status')
            .eq('user_id', invoker_user_id)
            .eq('metadata->>source_image_url', sourceImageUrlForCheck)
            .eq('metadata->>prompt', prompt_text)
            .in('status', ['queued', 'processing'])
            .maybeSingle();

        if (checkError) {
            console.warn(`[QueueProxy][${requestId}] Error checking for duplicate jobs:`, checkError.message);
        }

        if (existingJob) {
            console.log(`[QueueProxy][${requestId}] Found existing active job ${existingJob.id}. Re-triggering poller instead of creating a new job.`);
            supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id: existingJob.id } }).catch(console.error);
            return new Response(JSON.stringify({ success: true, jobId: existingJob.id, message: "Existing job found and re-triggered." }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200
            });
        }
    }
    // --- End Duplicate Job Check ---

    // Step 1: Upload the source image to Supabase Storage to get a persistent URL
    const storagePath = `${invoker_user_id}/source_${Date.now()}_${originalFilename}`;
    const { error: storageError } = await supabase.storage.from(UPLOAD_BUCKET).upload(storagePath, imageFile, {
      contentType: imageFile.type,
      upsert: true
    });
    if (storageError) throw new Error(`Failed to upload source image to storage: ${storageError.message}`);
    const { data: { publicUrl: sourceImageUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(storagePath);
    console.log(`[QueueProxy][${requestId}] Source image uploaded to Supabase Storage: ${sourceImageUrl}`);
    // Step 2: Upload the same image to ComfyUI for processing
    const uploadedFilename = await uploadImageToComfyUI(sanitizedAddress, imageFile, originalFilename);
    console.log(`[QueueProxy][${requestId}] Successfully uploaded image to ComfyUI. Filename: ${uploadedFilename}`);
    
    // Step 3: Prepare and queue the ComfyUI workflow
    const template = workflow_type === 'conservative_skin' ? workflowTemplateSkin : workflowTemplate;
    console.log(`[QueueProxy][${requestId}] Using workflow type: ${workflow_type || 'standard'}`);
    const finalWorkflow = JSON.parse(template);
    
    if (workflow_type === 'conservative_skin') {
        finalWorkflow['3'].inputs.image = uploadedFilename;
        if (upscale_factor) {
            // The LDSR workflow (node 6) does a fixed x4 upscale.
            // Node 7 then scales that result. To get the final desired upscale_factor,
            // we need to calculate the secondary scale factor.
            const secondary_scale_factor = parseFloat(upscale_factor) / 4.0;
            finalWorkflow['8'].inputs.Number = String(secondary_scale_factor);
            console.log(`[QueueProxy][${requestId}] LDSR workflow: User wants x${upscale_factor}, LDSR is x4, so secondary scale is set to ${secondary_scale_factor}`);
        }
    } else {
        finalWorkflow['404'].inputs.image = uploadedFilename;
        finalWorkflow['307'].inputs.String = prompt_text;
        const randomSeed = Math.floor(Math.random() * 1000000000000000);
        finalWorkflow['407'].inputs.seed = randomSeed;
        finalWorkflow['432'].inputs.seed = randomSeed;
        if (upscale_factor) {
            finalWorkflow['410'].inputs.value = parseFloat(upscale_factor);
        }
    }

    const queueUrl = `${sanitizedAddress}/prompt`;
    const payload = {
      prompt: finalWorkflow
    };
    console.log(`[QueueProxy][${requestId}] Sending prompt to: ${queueUrl}`);
    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ComfyUI server responded with status ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");
    // Step 4: Create the job record in our database with the correct Supabase URL
    const { data: newJob, error: insertError } = await supabase.from('mira-agent-comfyui-jobs').insert({
      user_id: invoker_user_id,
      comfyui_address: sanitizedAddress,
      comfyui_prompt_id: data.prompt_id,
      status: 'queued',
      main_agent_job_id: main_agent_job_id,
      retry_count: 0, // Initialize retry count
      metadata: {
        source: source || 'refiner',
        prompt: prompt_text,
        original_prompt_for_gallery: original_prompt_for_gallery || `Refined: ${prompt_text?.slice(0, 40) || 'image'}...`,
        invoker_user_id: invoker_user_id,
        source_image_url: sourceImageUrl, // <-- CRITICAL FIX: Use the public Supabase URL
        workflow_type: workflow_type || 'standard',
        workflow_payload: payload // Save the workflow for retries
      }
    }).select('id').single();
    if (insertError) throw insertError;
    // Step 5: Asynchronously start the poller
    supabase.functions.invoke('MIRA-AGENT-poller-comfyui', {
      body: {
        job_id: newJob.id
      }
    }).catch(console.error);
    return new Response(JSON.stringify({
      success: true,
      jobId: newJob.id
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(`[QueueProxy][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});