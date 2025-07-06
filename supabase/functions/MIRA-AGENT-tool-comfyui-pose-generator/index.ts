import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const workflowWithoutRef = `{
  "6": {
    "inputs": {
      "text": [
        "192",
        0
      ],
      "clip": [
        "212",
        1
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Positive Prompt)"
    }
  },
  "8": {
    "inputs": {
      "samples": [
        "197",
        0
      ],
      "vae": [
        "39",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE Decode"
    }
  },
  "35": {
    "inputs": {
      "guidance": 3.5,
      "conditioning": [
        "177",
        0
      ]
    },
    "class_type": "FluxGuidance",
    "_meta": {
      "title": "FluxGuidance"
    }
  },
  "37": {
    "inputs": {
      "unet_name": "flux1-kontext-dev.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "Load Diffusion Model"
    }
  },
  "38": {
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
  "39": {
    "inputs": {
      "vae_name": "ae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "Load VAE"
    }
  },
  "124": {
    "inputs": {
      "pixels": [
        "214",
        0
      ],
      "vae": [
        "39",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE Encode"
    }
  },
  "135": {
    "inputs": {
      "conditioning": [
        "6",
        0
      ]
    },
    "class_type": "ConditioningZeroOut",
    "_meta": {
      "title": "ConditioningZeroOut"
    }
  },
  "177": {
    "inputs": {
      "conditioning": [
        "6",
        0
      ],
      "latent": [
        "124",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "ReferenceLatent"
    }
  },
  "190": {
    "inputs": {
      "prompt": [
        "193",
        0
      ],
      "safety_settings": "BLOCK_NONE",
      "response_type": "text",
      "model": "gemini-2.5-pro",
      "api_key": "AIzaSyByuyPAPHMnftan3cvqaZRTTwlGATYinnA",
      "proxy": "",
      "system_instruction": [
        "195",
        0
      ],
      "error_fallback_value": "",
      "seed": 959188114,
      "temperature": 0.7500000000000001,
      "num_predict": 0,
      "image_1": [
        "214",
        0
      ]
    },
    "class_type": "Ask_Gemini",
    "_meta": {
      "title": "Ask Gemini"
    }
  },
  "192": {
    "inputs": {
      "value": [
        "190",
        0
      ]
    },
    "class_type": "PrimitiveString",
    "_meta": {
      "title": "String"
    }
  },
  "193": {
    "inputs": {
      "String": "change their pose to match this : insert pose here, keep everything else the same"
    },
    "class_type": "String",
    "_meta": {
      "title": "editing task"
    }
  },
  "194": {
    "inputs": {
      "text": [
        "192",
        0
      ]
    },
    "class_type": "ShowText|pysssss",
    "_meta": {
      "title": "Show Text 🐍"
    }
  },
  "195": {
    "inputs": {
      "String": "You are an expert prompt engineer for a powerful image-to-image editing model called \\"Kontext\\". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model. The final prompt must be in English and must not exceed 512 tokens.\\nYour process is to first apply the General Principles, then the crucial Reference Image Handling rule, and finally review the Advanced Examples to guide your prompt construction.\\nPart 1: General Principles for All Edits\\nThese are your foundational rules for constructing any prompt.\\nA. Core Mandate: Specificity and Preservation\\nBe Specific: Always translate vague user requests into precise instructions.\\nPreserve by Default: Your most important task is to identify what should not change. Proactively add clauses to preserve key aspects of the image. When in doubt, add a preservation instruction.\\nIdentify Subjects Clearly: Never use vague pronouns. Describe the subject based on the reference image (\\"the man in the orange jacket\\").\\nB. Verb Choice is Crucial\\nUse controlled verbs like \\"Change,\\" \\"Replace,\\" \\"Add,\\" or \\"Remove\\" for targeted edits.\\nUse \\"Transform\\" only for significant, holistic style changes.\\nC. Hyper-Detailed Character & Identity LOCKDOWN\\nThis is one of your most critical tasks. A simple \\"preserve face\\" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.\\nYour Mandate:\\nAnalyze & Describe: Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks').\\nEmbed in Prompt: Weave these exact descriptions into your preservation clause to leave no room for interpretation.\\nExample of Application:\\nUser Request: \\"Make this man a viking.\\"\\nWeak Prompt (AVOID): \\"Change the man's clothes to a viking warrior's outfit while preserving his face.\\"\\nStrong Prompt (CORRECT): \\"For the man with a square jaw, light olive skin, short dark hair, and brown eyes, change his clothes to a viking warrior's outfit. It is absolutely critical to preserve his exact identity by maintaining these specific features: his square jaw, light olive skin tone, unique nose and mouth shape, and brown eyes.\\"\\nD. Composition and Background Control\\nExample: \\"Change the background to a sunny beach while keeping the person in the exact same position, scale, and pose. Maintain the identical camera angle, framing, and perspective.\\"\\nE. Text Editing: Use a Strict Format\\nFormat: Replace '[original text]' with '[new text]'\\nF. Style Transfer (via Text)\\nNamed Style: \\"Transform to a 1960s pop art poster style.\\"\\nDescribed Style: \\"Convert to a pencil sketch with natural graphite lines and visible paper texture.\\"\\nPart 2: The Golden Rule of Reference Image Handling\\nThis is the most important rule for any request involving more than one concept (e.g., \\"change A to be like B\\").\\nTechnical Reality: The Kontext model only sees one image canvas. If a reference image is provided, it will be pre-processed onto that same canvas, typically side-by-side.\\nYour Mandate: DESCRIBE, DON'T POINT. You must never create a prompt that says \\"use the image on the right\\" or \\"like the reference image.\\" This will fail.\\nYour Method: Your prompt must be self-contained. You must visually analyze the reference portion of the image, extract the key attributes (pattern, color, shape, texture, pose), and then verbally describe those attributes as the desired change for the content portion of the image.\\nPart 3: Advanced, Detailed Examples (The Principle of Hyper-Preservation)\\nThis principle is key: Whatever doesn't need to be changed must be described and locked down in extreme detail, embedding descriptions directly into the prompt.\\nExample 1: Clothing Change (Preserving Person and Background)\\nUser Request: \\"Change his t-shirt to blue.\\"\\nYour Optimized Prompt: \\"For the man with fair skin, a short black haircut, a defined jawline, and a slight smile, change his red crew-neck t-shirt to a deep royal blue color. It is absolutely critical to preserve his exact identity, including his specific facial structure, hazel eyes, and fair skin tone. His pose, the black jeans he is wearing, and his white sneakers must remain identical. The background, a bustling city street with yellow taxis and glass-front buildings, must be preserved in every detail, including the specific reflections and the soft daytime lighting.\\"\\nExample 2: Background Change (Preserving Subject and Lighting)\\nUser Request: \\"Put her in Paris.\\"\\nYour Optimized Prompt: \\"For the woman with long blonde hair, fair skin, and blue eyes, change the background to an outdoor Parisian street cafe with the Eiffel Tower visible in the distant background. It is critical to keep the woman perfectly intact. Her seated pose, with one hand on the white coffee cup, must not change. Preserve her exact facial features (thin nose, defined cheekbones), her makeup, her fair skin tone, and the precise folds and emerald-green color of her dress. The warm, soft lighting on her face and dress from the original image must be maintained.\\"\\nExample 3: Reference on Canvas - Object Swap (Applying The Golden Rule)\\nUser Request: \\"Change his jacket to be like that shirt.\\"\\nReference Context: Canvas with man in orange jacket (left) and striped shirt (right).\\nYour Optimized Prompt: \\"For the man on the left, who has a short fade haircut, light-brown skin, and is wearing sunglasses, replace his orange bomber jacket with a short-sleeved, collared shirt featuring a pattern of thin, horizontal red and white stripes. It is critical to preserve his exact identity, including his specific facial structure and light-brown skin tone, as well as his pose and the entire original background of the stone building facade.\\"\\nSummary of Your Task:\\nYour output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles, especially the Hyper-Detailed Identity Lockdown and the Golden Rule of Reference Handling, to construct a single, precise, and explicit instruction. Describe what to change, but describe what to keep in even greater detail."
    },
    "class_type": "String",
    "_meta": {
      "title": "roleprompt for editing task"
    }
  },
  "196": {
    "inputs": {
      "cfg": 1,
      "nag_scale": 7.5,
      "nag_tau": 2.5,
      "nag_alpha": 0.25,
      "nag_sigma_end": 0,
      "model": [
        "212",
        0
      ],
      "positive": [
        "35",
        0
      ],
      "negative": [
        "135",
        0
      ],
      "nag_negative": [
        "198",
        0
      ],
      "latent_image": [
        "124",
        0
      ]
    },
    "class_type": "NAGCFGGuider",
    "_meta": {
      "title": "NAGCFGGuider"
    }
  },
  "197": {
    "inputs": {
      "noise": [
        "200",
        0
      ],
      "guider": [
        "196",
        0
      ],
      "sampler": [
        "202",
        0
      ],
      "sigmas": [
        "204",
        0
      ],
      "latent_image": [
        "124",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "SamplerCustomAdvanced"
    }
  },
  "198": {
    "inputs": {
      "conditioning": [
        "6",
        0
      ]
    },
    "class_type": "ConditioningZeroOut",
    "_meta": {
      "title": "ConditioningZeroOut"
    }
  },
  "200": {
    "inputs": {
      "noise_seed": 558971480754733
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "RandomNoise"
    }
  },
  "202": {
    "inputs": {
      "sampler_name": "euler"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "KSamplerSelect"
    }
  },
  "204": {
    "inputs": {
      "scheduler": "simple",
      "steps": 20,
      "denoise": 1,
      "model": [
        "37",
        0
      ]
    },
    "class_type": "BasicScheduler",
    "_meta": {
      "title": "BasicScheduler"
    }
  },
  "212": {
    "inputs": {
      "lora_name": "42lux-UltimateAtHome-flux-highresfix.safetensors",
      "strength_model": 0.5000000000000001,
      "strength_clip": 0.5000000000000001,
      "model": [
        "37",
        0
      ],
      "clip": [
        "38",
        0
      ]
    },
    "class_type": "LoraLoader",
    "_meta": {
      "title": "Load LoRA"
    }
  },
  "213": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": [
        "8",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Output_BackUP-version"
    }
  },
  "214": {
    "inputs": {
      "image": "10001.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Original_Image"
    }
  }
}`;
const workflowWithRef = `{
  "6": {
    "inputs": {
      "text": [
        "192",
        0
      ],
      "clip": [
        "212",
        1
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Positive Prompt)"
    }
  },
  "8": {
    "inputs": {
      "samples": [
        "197",
        0
      ],
      "vae": [
        "39",
        0
      ]
    },
    "class_type": "VAEDecode",
    "_meta": {
      "title": "VAE Decode"
    }
  },
  "35": {
    "inputs": {
      "guidance": 3.5,
      "conditioning": [
        "177",
        0
      ]
    },
    "class_type": "FluxGuidance",
    "_meta": {
      "title": "FluxGuidance"
    }
  },
  "37": {
    "inputs": {
      "unet_name": "flux1-kontext-dev.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "Load Diffusion Model"
    }
  },
  "38": {
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
  "39": {
    "inputs": {
      "vae_name": "ae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "Load VAE"
    }
  },
  "124": {
    "inputs": {
      "pixels": [
        "214",
        0
      ],
      "vae": [
        "39",
        0
      ]
    },
    "class_type": "VAEEncode",
    "_meta": {
      "title": "VAE Encode"
    }
  },
  "135": {
    "inputs": {
      "conditioning": [
        "6",
        0
      ]
    },
    "class_type": "ConditioningZeroOut",
    "_meta": {
      "title": "ConditioningZeroOut"
    }
  },
  "177": {
    "inputs": {
      "conditioning": [
        "6",
        0
      ],
      "latent": [
        "124",
        0
      ]
    },
    "class_type": "ReferenceLatent",
    "_meta": {
      "title": "ReferenceLatent"
    }
  },
  "190": {
    "inputs": {
      "prompt": [
        "193",
        0
      ],
      "safety_settings": "BLOCK_NONE",
      "response_type": "text",
      "model": "gemini-2.5-pro",
      "api_key": "AIzaSyByuyPAPHMnftan3cvqaZRTTwlGATYinnA",
      "proxy": "",
      "system_instruction": [
        "195",
        0
      ],
      "error_fallback_value": "",
      "seed": 959188114,
      "temperature": 0.7500000000000001,
      "num_predict": 0,
      "image_1": [
        "214",
        0
      ],
      "image_2": [
        "215",
        0
      ]
    },
    "class_type": "Ask_Gemini",
    "_meta": {
      "title": "Ask Gemini"
    }
  },
  "192": {
    "inputs": {
      "value": [
        "190",
        0
      ]
    },
    "class_type": "PrimitiveString",
    "_meta": {
      "title": "String"
    }
  },
  "193": {
    "inputs": {
      "String": "change their pose to match my reference, keep everything else the same"
    },
    "class_type": "String",
    "_meta": {
      "title": "editing task"
    }
  },
  "194": {
    "inputs": {
      "text": [
        "192",
        0
      ]
    },
    "class_type": "ShowText|pysssss",
    "_meta": {
      "title": "Show Text 🐍"
    }
  },
  "195": {
    "inputs": {
      "String": "You are an expert prompt engineer for a powerful image-to-image editing model called \\"Kontext\\". Your sole purpose is to receive a user's editing request and image(s), and translate that request into a single, optimized, and highly effective prompt for the Kontext model. The final prompt must be in English and must not exceed 512 tokens.\\nYour process is to first apply the General Principles, then the crucial Reference Image Handling rule, and finally review the Advanced Examples to guide your prompt construction.\\nPart 1: General Principles for All Edits\\nThese are your foundational rules for constructing any prompt.\\nA. Core Mandate: Specificity and Preservation\\nBe Specific: Always translate vague user requests into precise instructions.\\nPreserve by Default: Your most important task is to identify what should not change. Proactively add clauses to preserve key aspects of the image. When in doubt, add a preservation instruction.\\nIdentify Subjects Clearly: Never use vague pronouns. Describe the subject based on the reference image (\\"the man in the orange jacket\\").\\nB. Verb Choice is Crucial\\nUse controlled verbs like \\"Change,\\" \\"Replace,\\" \\"Add,\\" or \\"Remove\\" for targeted edits.\\nUse \\"Transform\\" only for significant, holistic style changes.\\nC. Hyper-Detailed Character & Identity LOCKDOWN\\nThis is one of your most critical tasks. A simple \\"preserve face\\" clause is a failure. You must actively describe the person's specific features from the image and embed these descriptions directly into the preservation command. This locks down their identity.\\nYour Mandate:\\nAnalyze & Describe: Look at the person in the image and identify their specific, observable features (e.g., 'square jaw', 'light olive skin', 'short black fade', 'blue eyes', 'freckles on cheeks').\\nEmbed in Prompt: Weave these exact descriptions into your preservation clause to leave no room for interpretation.\\nExample of Application:\\nUser Request: \\"Make this man a viking.\\"\\nWeak Prompt (AVOID): \\"Change the man's clothes to a viking warrior's outfit while preserving his face.\\"\\nStrong Prompt (CORRECT): \\"For the man with a square jaw, light olive skin, short dark hair, and brown eyes, change his clothes to a viking warrior's outfit. It is absolutely critical to preserve his exact identity by maintaining these specific features: his square jaw, light olive skin tone, unique nose and mouth shape, and brown eyes.\\"\\nD. Composition and Background Control\\nExample: \\"Change the background to a sunny beach while keeping the person in the exact same position, scale, and pose. Maintain the identical camera angle, framing, and perspective.\\"\\nE. Text Editing: Use a Strict Format\\nFormat: Replace '[original text]' with '[new text]'\\nF. Style Transfer (via Text)\\nNamed Style: \\"Transform to a 1960s pop art poster style.\\"\\nDescribed Style: \\"Convert to a pencil sketch with natural graphite lines and visible paper texture.\\"\\nPart 2: The Golden Rule of Reference Image Handling\\nThis is the most important rule for any request involving more than one concept (e.g., \\"change A to be like B\\").\\nTechnical Reality: The Kontext model only sees one image canvas. If a reference image is provided, it will be pre-processed onto that same canvas, typically side-by-side.\\nYour Mandate: DESCRIBE, DON'T POINT. You must never create a prompt that says \\"use the image on the right\\" or \\"like the reference image.\\" This will fail.\\nYour Method: Your prompt must be self-contained. You must visually analyze the reference portion of the image, extract the key attributes (pattern, color, shape, texture, pose), and then verbally describe those attributes as the desired change for the content portion of the image.\\nPart 3: Advanced, Detailed Examples (The Principle of Hyper-Preservation)\\nThis principle is key: Whatever doesn't need to be changed must be described and locked down in extreme detail, embedding descriptions directly into the prompt.\\nExample 1: Clothing Change (Preserving Person and Background)\\nUser Request: \\"Change his t-shirt to blue.\\"\\nYour Optimized Prompt: \\"For the man with fair skin, a short black haircut, a defined jawline, and a slight smile, change his red crew-neck t-shirt to a deep royal blue color. It is absolutely critical to preserve his exact identity, including his specific facial structure, hazel eyes, and fair skin tone. His pose, the black jeans he is wearing, and his white sneakers must remain identical. The background, a bustling city street with yellow taxis and glass-front buildings, must be preserved in every detail, including the specific reflections and the soft daytime lighting.\\"\\nExample 2: Background Change (Preserving Subject and Lighting)\\nUser Request: \\"Put her in Paris.\\"\\nYour Optimized Prompt: \\"For the woman with long blonde hair, fair skin, and blue eyes, change the background to an outdoor Parisian street cafe with the Eiffel Tower visible in the distant background. It is critical to keep the woman perfectly intact. Her seated pose, with one hand on the white coffee cup, must not change. Preserve her exact facial features (thin nose, defined cheekbones), her makeup, her fair skin tone, and the precise folds and emerald-green color of her dress. The warm, soft lighting on her face and dress from the original image must be maintained.\\"\\nExample 3: Reference on Canvas - Object Swap (Applying The Golden Rule)\\nUser Request: \\"Change his jacket to be like that shirt.\\"\\nReference Context: Canvas with man in orange jacket (left) and striped shirt (right).\\nYour Optimized Prompt: \\"For the man on the left, who has a short fade haircut, light-brown skin, and is wearing sunglasses, replace his orange bomber jacket with a short-sleeved, collared shirt featuring a pattern of thin, horizontal red and white stripes. It is critical to preserve his exact identity, including his specific facial structure and light-brown skin tone, as well as his pose and the entire original background of the stone building facade.\\"\\nSummary of Your Task:\\nYour output is NOT a conversation; it is ONLY the final, optimized prompt. Analyze the request and the single image canvas. Apply all relevant principles, especially the Hyper-Detailed Identity Lockdown and the Golden Rule of Reference Handling, to construct a single, precise, and explicit instruction. Describe what to change, but describe what to keep in even greater detail."
    },
    "class_type": "String",
    "_meta": {
      "title": "roleprompt for editing task"
    }
  },
  "196": {
    "inputs": {
      "cfg": 1,
      "nag_scale": 7.5,
      "nag_tau": 2.5,
      "nag_alpha": 0.25,
      "nag_sigma_end": 0,
      "model": [
        "212",
        0
      ],
      "positive": [
        "35",
        0
      ],
      "negative": [
        "135",
        0
      ],
      "nag_negative": [
        "198",
        0
      ],
      "latent_image": [
        "124",
        0
      ]
    },
    "class_type": "NAGCFGGuider",
    "_meta": {
      "title": "NAGCFGGuider"
    }
  },
  "197": {
    "inputs": {
      "noise": [
        "200",
        0
      ],
      "guider": [
        "196",
        0
      ],
      "sampler": [
        "202",
        0
      ],
      "sigmas": [
        "204",
        0
      ],
      "latent_image": [
        "124",
        0
      ]
    },
    "class_type": "SamplerCustomAdvanced",
    "_meta": {
      "title": "SamplerCustomAdvanced"
    }
  },
  "198": {
    "inputs": {
      "conditioning": [
        "6",
        0
      ]
    },
    "class_type": "ConditioningZeroOut",
    "_meta": {
      "title": "ConditioningZeroOut"
    }
  },
  "200": {
    "inputs": {
      "noise_seed": 558971480754733
    },
    "class_type": "RandomNoise",
    "_meta": {
      "title": "RandomNoise"
    }
  },
  "202": {
    "inputs": {
      "sampler_name": "euler"
    },
    "class_type": "KSamplerSelect",
    "_meta": {
      "title": "KSamplerSelect"
    }
  },
  "204": {
    "inputs": {
      "scheduler": "simple",
      "steps": 20,
      "denoise": 1,
      "model": [
        "37",
        0
      ]
    },
    "class_type": "BasicScheduler",
    "_meta": {
      "title": "BasicScheduler"
    }
  },
  "212": {
    "inputs": {
      "lora_name": "42lux-UltimateAtHome-flux-highresfix.safetensors",
      "strength_model": 0.5000000000000001,
      "strength_clip": 0.5000000000000001,
      "model": [
        "37",
        0
      ],
      "clip": [
        "38",
        0
      ]
    },
    "class_type": "LoraLoader",
    "_meta": {
      "title": "Load LoRA"
    }
  },
  "213": {
    "inputs": {
      "filename_prefix": "ComfyUI",
      "images": [
        "8",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Output_BackUP-version"
    }
  },
  "214": {
    "inputs": {
      "image": "10001.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Original_Image"
    }
  },
  "215": {
    "inputs": {
      "image": "10001.jpg"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "Pose_image"
    }
  }
}`;

async function downloadFromSupabase(supabase: any, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Supabase download failed: ${error.message}`);
    return data;
}

async function uploadToComfyUI(comfyUiUrl: string, imageBlob: Blob, filename: string) {
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
  const requestId = `pose-generator-${Date.now()}`;
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  if (!COMFYUI_ENDPOINT_URL) throw new Error("COMFYUI_ENDPOINT_URL is not set.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");

  try {
    const { base_model_url, pose_prompt, pose_image_url } = await req.json();
    if (!base_model_url || !pose_prompt) {
      throw new Error("base_model_url and pose_prompt are required.");
    }

    console.log(`[PoseGenerator][${requestId}] Downloading base model from: ${base_model_url}`);
    const baseModelBlob = await downloadFromSupabase(supabase, base_model_url);
    const baseModelFilename = await uploadToComfyUI(sanitizedAddress, baseModelBlob, 'base_model.png');
    console.log(`[PoseGenerator][${requestId}] Base model uploaded to ComfyUI as: ${baseModelFilename}`);

    const workflow = pose_image_url ? JSON.parse(workflowWithRef) : JSON.parse(workflowWithoutRef);
    const finalWorkflow = workflow;

    finalWorkflow['214'].inputs.image = baseModelFilename;
    finalWorkflow['193'].inputs.String = pose_prompt;

    if (pose_image_url) {
      console.log(`[PoseGenerator][${requestId}] Downloading pose reference from: ${pose_image_url}`);
      const poseImageBlob = await downloadFromSupabase(supabase, pose_image_url);
      const poseImageFilename = await uploadToComfyUI(sanitizedAddress, poseImageBlob, 'pose_ref.png');
      finalWorkflow['215'].inputs.image = poseImageFilename;
      console.log(`[PoseGenerator][${requestId}] Pose reference uploaded as: ${poseImageFilename}`);
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
    console.log(`[PoseGenerator][${requestId}] Job queued successfully with prompt_id: ${data.prompt_id}`);

    return new Response(JSON.stringify({ comfyui_prompt_id: data.prompt_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[PoseGenerator][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});