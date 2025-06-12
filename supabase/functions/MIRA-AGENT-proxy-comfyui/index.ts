import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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
  "20": {
    "inputs": {
      "dishonesty_factor": -0.010000000000000002,
      "start_percent": 0.6600000000000001,
      "end_percent": 0.9500000000000002,
      "sampler": [
        "21",
        0
      ]
    },
    "class_type": "LyingSigmaSampler",
    "_meta": {
      "title": "Lying Sigma Sampler"
    }
  },
  "21": {
    "inputs": {
      "sampler_name": "dpmpp_2m"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "KSamplerSelect"
    }
  },
  "249": {
    "inputs": {
      "lora_name": "IDunnohowtonameLora.safetensors",
      "strength_model": 0.8000000000000002,
      "model": [
        "304",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
    }
  },
  "304": {
    "inputs": {
      "unet_name": "realDream_flux1V1.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "Load Diffusion Model"
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
  "363": {
    "inputs": {
      "lora_name": "Samsung_UltraReal.safetensors",
      "strength_model": 0.6800000000000002,
      "model": [
        "249",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
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
  "402": {
    "inputs": {
      "control_net_name": "fluxcontrolnetupscale.safetensors"
    },
    "class_type": "ControlNetLoader",
    "_meta": {
      "title": "Load ControlNet Model"
    }
  },
  "403": {
    "inputs": {
      "strength": 1.0000000000000002,
      "start_percent": 0,
      "end_percent": 1,
      "positive": [
        "349",
        0
      ],
      "negative": [
        "361",
        0
      ],
      "control_net": [
        "402",
        0
      ],
      "image": [
        "404",
        0
      ],
      "vae": [
        "10",
        0
      ]
    },
    "class_type": "ControlNetApplyAdvanced",
    "_meta": {
      "title": "Apply ControlNet"
    }
  },
  "404": {
    "inputs": {
      "image": "placeholder.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Load Image"
    }
  },
  "407": {
    "inputs": {
      "upscale_by": 1.4000000000000004,
      "seed": 576355546919873,
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
        "404",
        0
      ],
      "model": [
        "363",
        0
      ],
      "positive": [
        "403",
        0
      ],
      "negative": [
        "403",
        1
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
        "20",
        0
      ],
      "custom_sigmas": [
        "409",
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
      "model_name": "4x-UltraSharp.pth"
    },
    "class_type": "UpscaleModelLoader",
    "_meta": {
      "title": "Load Upscale Model"
    }
  },
  "409": {
    "inputs": {
      "scheduler": "normal",
      "steps": 20,
      "denoise": 0.25000000000000006,
      "model": [
        "363",
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

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `queue-proxy-${Date.now()}`;
  console.log(`[QueueProxy][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: config, error: configError } = await supabase
      .from('mira-agent-config')
      .select('value')
      .eq('key', 'comfyui_endpoint_address')
      .single();

    if (configError || !config?.value) {
      throw new Error("ComfyUI endpoint address is not configured in mira-agent-config table.");
    }
    const comfyui_address = (config.value as string).replace(/"/g, '');

    const body = await req.json();
    console.log(`[QueueProxy][${requestId}] Received request body:`, JSON.stringify(body));
    
    const { invoker_user_id } = body;
    let finalWorkflow;

    if (body.prompt_workflow) {
        console.log(`[QueueProxy][${requestId}] Handling legacy 'prompt_workflow' format.`);
        finalWorkflow = body.prompt_workflow;
    } else if (body.prompt_text && body.image_filename) {
        console.log(`[QueueProxy][${requestId}] Handling new 'prompt_text' and 'image_filename' format.`);
        finalWorkflow = JSON.parse(workflowTemplate);
        if (finalWorkflow['404']) finalWorkflow['404'].inputs.image = body.image_filename;
        if (finalWorkflow['307']) finalWorkflow['307'].inputs.String = body.prompt_text;
    } else {
        throw new Error("Request body must contain either 'prompt_workflow' or both 'prompt_text' and 'image_filename'.");
    }

    if (!invoker_user_id) throw new Error("Missing required parameter: invoker_user_id");
    
    console.log(`[QueueProxy][${requestId}] All parameters validated.`);

    const sanitizedAddress = comfyui_address.replace(/\/+$/, "");
    const queueUrl = `${sanitizedAddress}/prompt`;
    
    const payload = { 
      prompt: finalWorkflow 
    };
    console.log(`[QueueProxy][${requestId}] Sending prompt to: ${queueUrl}`);

    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify(payload),
    });

    console.log(`[QueueProxy][${requestId}] Received response from ComfyUI with status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[QueueProxy][${requestId}] ComfyUI prompt error:`, errorText);
      throw new Error(`ComfyUI server responded with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    if (!data.prompt_id) {
        throw new Error("ComfyUI did not return a prompt_id.");
    }
    console.log(`[QueueProxy][${requestId}] ComfyUI returned prompt_id: ${data.prompt_id}`);

    const { data: newJob, error: insertError } = await supabase
        .from('mira-agent-comfyui-jobs')
        .insert({
            user_id: invoker_user_id,
            comfyui_address: sanitizedAddress,
            comfyui_prompt_id: data.prompt_id,
            status: 'queued'
        })
        .select('id')
        .single();

    if (insertError) throw insertError;
    console.log(`[QueueProxy][${requestId}] Created DB job with ID: ${newJob.id}`);

    console.log(`[QueueProxy][${requestId}] Invoking poller for job ${newJob.id}...`);
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