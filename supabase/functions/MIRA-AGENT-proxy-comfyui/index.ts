import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
      "guidance": 3.1,
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
      "guidance": 3.1,
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
  "389": {
    "inputs": {
      "filename_prefix": "Output",
      "images": [
        "407",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Save Image"
    }
  },
  "404": {
    "inputs": {
      "image": "1749818990465_1.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "InputImage"
    }
  },
  "407": {
    "inputs": {
      "upscale_by": [
        "410",
        0
      ],
      "seed": 323710341375553,
      "steps": 20,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 0.25000000000000006,
      "mode_type": "Linear",
      "tile_width": 1024,
      "tile_height": 1024,
      "mask_blur": 8,
      "tile_padding": 32,
      "seam_fix_mode": "None",
      "seam_fix_denoise": 1,
      "seam_fix_width": 64,
      "seam_fix_mask_blur": 8,
      "seam_fix_padding": 16,
      "force_uniform_tiles": true,
      "tiled_decode": false,
      "image": [
        "421",
        0
      ],
      "model": [
        "419",
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
      "model_name": "4x-UltraSharpV2.safetensors"
    },
    "class_type": "UpscaleModelLoader",
    "_meta": {
      "title": "Load Upscale Model"
    }
  },
  "410": {
    "inputs": {
      "value": 2.0000000000000004
    },
    "class_type": "FloatConstant",
    "_meta": {
      "title": "Upscale_Scale"
    }
  },
  "411": {
    "inputs": {
      "images": [
        "407",
        0
      ]
    },
    "class_type": "PreviewImage",
    "_meta": {
      "title": "Preview Image"
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
      "strength_model": 0.8000000000000002,
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
      "strength_model": 0.25000000000000006,
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
      "strength_model": 0.7800000000000001,
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
  "419": {
    "inputs": {
      "max_shift": 1.1500000000000001,
      "base_shift": 0.5000000000000001,
      "model": [
        "418",
        0
      ],
      "latent": [
        "420",
        0
      ]
    },
    "class_type": "ModelSamplingFluxNormalized",
    "_meta": {
      "title": "Model Sampling Flux Normalized"
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
        "419",
        1
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
      "dishonesty_factor": -0.020000000000000004,
      "start_percent": 0.28,
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
      "steps": 20,
      "denoise": 0.30000000000000004,
      "model": [
        "419",
        0
      ]
    },
    "class_type": "BasicScheduler",
    "_meta": {
      "title": "BasicScheduler"
    }
  }
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
        } else if (body.base64_image_data) {
            console.log(`[QueueProxy][${requestId}] Handling JSON body with base64_image_data.`);
            const imageBuffer = decodeBase64(body.base64_image_data);
            imageFile = new Blob([imageBuffer], { type: body.mime_type || 'image/png' });
            sourceImageUrl = `agent_history_image.png`;
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
        finalWorkflow['410'].inputs.value = parseFloat(upscale_factor);
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