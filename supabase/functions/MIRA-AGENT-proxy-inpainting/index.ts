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
      "seed": 527229883475207,
      "steps": 20,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "normal",
      "denoise": 1,
      "model": [
        "39",
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
      "filename_prefix": "ComfyUI",
      "images": [
        "8",
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
      "image": "fd909d80-9830-42ae-a221-35478e6c69ef.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Input Image"
    }
  },
  "23": {
    "inputs": {
      "text": "Wearing pink Maxi Dress",
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
      "noise_mask": false,
      "positive": [
        "51",
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
        "17",
        0
      ],
      "mask": [
        "47",
        0
      ]
    },
    "class_type": "InpaintModelConditioning",
    "_meta": {
      "title": "InpaintModelConditioning"
    }
  },
  "39": {
    "inputs": {
      "model": [
        "31",
        0
      ]
    },
    "class_type": "DifferentialDiffusion",
    "_meta": {
      "title": "Differential Diffusion"
    }
  },
  "45": {
    "inputs": {
      "image": "e7fc70ad-63e9-4457-9d35-aeac7365a079.png"
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
        "45",
        0
      ]
    },
    "class_type": "ImageToMask",
    "_meta": {
      "title": "Convert Image to Mask"
    }
  },
  "48": {
    "inputs": {
      "style_model_name": "fluxcontrolnetupscale.safetensors"
    },
    "class_type": "StyleModelLoader",
    "_meta": {
      "title": "Load Style Model"
    }
  },
  "49": {
    "inputs": {
      "clip_name": "sigclip_vision_patch14_384.safetensors"
    },
    "class_type": "CLIPVisionLoader",
    "_meta": {
      "title": "Load CLIP Vision"
    }
  },
  "50": {
    "inputs": {
      "crop": "center",
      "clip_vision": [
        "49",
        0
      ],
      "image": [
        "52",
        0
      ]
    },
    "class_type": "CLIPVisionEncode",
    "_meta": {
      "title": "CLIP Vision Encode"
    }
  },
  "51": {
    "inputs": {
      "strength": 0.30000000000000004,
      "strength_type": "attn_bias",
      "conditioning": [
        "26",
        0
      ],
      "style_model": [
        "48",
        0
      ],
      "clip_vision_output": [
        "50",
        0
      ]
    },
    "class_type": "StyleModelApply",
    "_meta": {
      "title": "Apply Style Model"
    }
  },
  "52": {
    "inputs": {
      "image": "61rtzqla9LL._AC_SX679_.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Input Reference"
    }
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
      reference_image_base64, // Optional
      prompt,
      denoise,
    } = await req.json();

    if (!user_id || !source_image_base64 || !mask_image_base64) {
      throw new Error("Missing required parameters: user_id, source_image_base64, and mask_image_base64 are required.");
    }

    const sourceBlob = new Blob([decodeBase64(source_image_base64)], { type: 'image/png' });
    const maskBlob = new Blob([decodeBase64(mask_image_base64)], { type: 'image/png' });

    const uploadPromises = [
      uploadImageToComfyUI(sanitizedAddress, sourceBlob, 'source.png'),
      uploadImageToComfyUI(sanitizedAddress, maskBlob, 'mask.png')
    ];

    let hasReferenceImage = !!reference_image_base64;
    if (hasReferenceImage) {
      const referenceBlob = new Blob([decodeBase64(reference_image_base64)], { type: 'image/png' });
      uploadPromises.push(uploadImageToComfyUI(sanitizedAddress, referenceBlob, 'reference.png'));
    }

    const [sourceFilename, maskFilename, referenceFilename] = await Promise.all(uploadPromises);

    const finalWorkflow = JSON.parse(workflowTemplate);
    
    // Populate required inputs
    finalWorkflow['17'].inputs.image = sourceFilename;
    finalWorkflow['45'].inputs.image = maskFilename;
    finalWorkflow['23'].inputs.text = prompt || "masterpiece, best quality";
    finalWorkflow['7'].inputs.text = "ugly, blurry, deformed, text, watermark";
    finalWorkflow['3'].inputs.seed = Math.floor(Math.random() * 1e15);
    if (denoise) {
      finalWorkflow['3'].inputs.denoise = denoise;
    }

    // Handle optional reference image
    if (hasReferenceImage && referenceFilename) {
      finalWorkflow['52'].inputs.image = referenceFilename;
      // Use default strength from template
    } else {
      // No reference image provided. We must still provide a dummy input to the style model nodes
      // and set the strength to 0 to nullify its effect.
      const dummyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      const dummyBlob = new Blob([decodeBase64(dummyPngBase64)], { type: 'image/png' });
      const dummyFilename = await uploadImageToComfyUI(sanitizedAddress, dummyBlob, 'dummy.png');
      
      finalWorkflow['52'].inputs.image = dummyFilename;
      finalWorkflow['51'].inputs.strength = 0.0; // Set strength to zero
      console.log("[InpaintingProxy] No reference image provided. Using dummy image and setting style strength to 0.");
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