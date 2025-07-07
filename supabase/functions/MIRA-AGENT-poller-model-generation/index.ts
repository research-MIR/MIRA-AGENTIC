import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
const POLLING_INTERVAL_MS = 5000;
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const MAX_RETRIES = 2;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const tiledUpscalerWorkflow = `{
  "10": {
    "inputs": {
      "vae_name": "ae.safetensors"
    },
    "class_type": "VAELoader",
    "_meta": {
      "title": "Load VAE"
    }
  },
  "48": {
    "inputs": {
      "clip_l": "",
      "t5xxl": "",
      "guidance": 2,
      "clip": [
        "298",
        0
      ]
    },
    "class_type": "CLIPTextEncodeFlux",
    "_meta": {
      "title": "CLIPTextEncodeFlux"
    }
  },
  "49": {
    "inputs": {
      "conditioning": [
        "48",
        0
      ]
    },
    "class_type": "ConditioningZeroOut",
    "_meta": {
      "title": "ConditioningZeroOut"
    }
  },
  "87": {
    "inputs": {
      "text": [
        "171",
        2
      ],
      "clip": [
        "298",
        0
      ]
    },
    "class_type": "CLIPTextEncode",
    "_meta": {
      "title": "CLIP Text Encode (Prompt)"
    }
  },
  "88": {
    "inputs": {
      "guidance": 3.5,
      "conditioning": [
        "87",
        0
      ]
    },
    "class_type": "FluxGuidance",
    "_meta": {
      "title": "FluxGuidance"
    }
  },
  "89": {
    "inputs": {
      "max_shift": 1.15,
      "base_shift": 0.5,
      "width": 1024,
      "height": 1024,
      "model": [
        "304",
        0
      ]
    },
    "class_type": "ModelSamplingFlux",
    "_meta": {
      "title": "ModelSamplingFlux"
    }
  },
  "91": {
    "inputs": {
      "strength": 0.8500000000000002,
      "start_percent": 0,
      "end_percent": 0.8500000000000002,
      "positive": [
        "88",
        0
      ],
      "negative": [
        "49",
        0
      ],
      "control_net": [
        "93",
        0
      ],
      "image": [
        "152",
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
  "93": {
    "inputs": {
      "control_net_name": "fluxcontrolnetupscale.safetensors"
    },
    "class_type": "ControlNetLoader",
    "_meta": {
      "title": "Load ControlNet Model"
    }
  },
  "96": {
    "inputs": {
      "upscale_method": "bicubic",
      "scale_by": [
        "316",
        0
      ],
      "image": [
        "148",
        0
      ]
    },
    "class_type": "ImageScaleBy",
    "_meta": {
      "title": "Upscale Image By"
    }
  },
  "115": {
    "inputs": {
      "seed": 622487950833006,
      "steps": 20,
      "cfg": 1,
      "sampler_name": "euler",
      "scheduler": "simple",
      "denoise": [
        "317",
        0
      ],
      "model": [
        "259",
        0
      ],
      "positive": [
        "91",
        0
      ],
      "negative": [
        "91",
        1
      ],
      "latent_image": [
        "118",
        0
      ]
    },
    "class_type": "KSampler",
    "_meta": {
      "title": "KSampler"
    }
  },
  "116": {
    "inputs": {
      "pixels": [
        "152",
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
  "118": {
    "inputs": {
      "samples": [
        "116",
        0
      ],
      "mask": [
        "152",
        1
      ]
    },
    "class_type": "SetLatentNoiseMask",
    "_meta": {
      "title": "Set Latent Noise Mask"
    }
  },
  "140": {
    "inputs": {
      "blend": 128,
      "images": [
        "158",
        0
      ],
      "tile_calc": [
        "150",
        1
      ]
    },
    "class_type": "DynamicTileMerge",
    "_meta": {
      "title": "TileMerge (Dynamic)"
    }
  },
  "142": {
    "inputs": {
      "samples": [
        "115",
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
  "148": {
    "inputs": {
      "image": [
        "160",
        0
      ],
      "alpha": [
        "178",
        0
      ]
    },
    "class_type": "JoinImageWithAlpha",
    "_meta": {
      "title": "Join Image with Alpha"
    }
  },
  "149": {
    "inputs": {
      "image": "ComfyUI_00139_.png"
    },
    "class_type": "LoadImage",
    "_meta": {
      "title": "INPUT_IMAGE_TOUPSCALE"
    }
  },
  "150": {
    "inputs": {
      "tile_width": 1024,
      "tile_height": 1024,
      "overlap": 264,
      "offset": 0,
      "image": [
        "275",
        0
      ]
    },
    "class_type": "DynamicTileSplit",
    "_meta": {
      "title": "TileSplit (Dynamic)"
    }
  },
  "151": {
    "inputs": {
      "image": [
        "150",
        0
      ]
    },
    "class_type": "ImpactImageBatchToImageList",
    "_meta": {
      "title": "Image Batch to Image List"
    }
  },
  "152": {
    "inputs": {
      "image": [
        "151",
        0
      ]
    },
    "class_type": "SplitImageWithAlpha",
    "_meta": {
      "title": "Split Image with Alpha"
    }
  },
  "158": {
    "inputs": {
      "images": [
        "142",
        0
      ]
    },
    "class_type": "ImageListToImageBatch",
    "_meta": {
      "title": "Image List to Image Batch"
    }
  },
  "160": {
    "inputs": {
      "upscale_model": [
        "161",
        0
      ],
      "image": [
        "204",
        0
      ]
    },
    "class_type": "ImageUpscaleWithModel",
    "_meta": {
      "title": "Upscale Image (using Model)"
    }
  },
  "161": {
    "inputs": {
      "model_name": "4x-UltraSharpV2.safetensors"
    },
    "class_type": "UpscaleModelLoader",
    "_meta": {
      "title": "Load Upscale Model"
    }
  },
  "171": {
    "inputs": {
      "text_input": "",
      "task": "prompt_gen_mixed_caption_plus",
      "fill_mask": true,
      "keep_model_loaded": true,
      "max_new_tokens": 1024,
      "num_beams": 3,
      "do_sample": true,
      "output_mask_select": "",
      "seed": 1116563907150578,
      "image": [
        "152",
        0
      ],
      "florence2_model": [
        "290",
        0
      ]
    },
    "class_type": "Florence2Run",
    "_meta": {
      "title": "Florence2Run"
    }
  },
  "178": {
    "inputs": {
      "channel": "red",
      "image": [
        "179",
        0
      ]
    },
    "class_type": "ImageToMask",
    "_meta": {
      "title": "Convert Image to Mask"
    }
  },
  "179": {
    "inputs": {
      "upscale_method": "nearest-exact",
      "scale_by": 4.000000000000001,
      "image": [
        "236",
        0
      ]
    },
    "class_type": "ImageScaleBy",
    "_meta": {
      "title": "Match the upscale model !!!"
    }
  },
  "190": {
    "inputs": {
      "padding": 16,
      "constraints": "ignore",
      "constraint_x": [
        "219",
        0
      ],
      "constraint_y": [
        "219",
        1
      ],
      "min_width": 0,
      "min_height": 0,
      "batch_behavior": "match_ratio",
      "mask": [
        "322",
        0
      ]
    },
    "class_type": "Mask To Region",
    "_meta": {
      "title": "Mask To Region"
    }
  },
  "192": {
    "inputs": {
      "force_resize_width": 0,
      "force_resize_height": 0,
      "image": [
        "149",
        0
      ],
      "mask": [
        "190",
        0
      ]
    },
    "class_type": "Cut By Mask",
    "_meta": {
      "title": "Cut By Mask"
    }
  },
  "204": {
    "inputs": {
      "kind": "RGB",
      "image": [
        "192",
        0
      ]
    },
    "class_type": "Change Channel Count",
    "_meta": {
      "title": "Change Channel Count"
    }
  },
  "219": {
    "inputs": {
      "image": [
        "322",
        0
      ]
    },
    "class_type": "Get Image Size",
    "_meta": {
      "title": "Get Image Size"
    }
  },
  "234": {
    "inputs": {
      "method": "intensity",
      "image": [
        "236",
        0
      ]
    },
    "class_type": "Image To Mask",
    "_meta": {
      "title": "Image To Mask"
    }
  },
  "236": {
    "inputs": {
      "force_resize_width": 0,
      "force_resize_height": 0,
      "image": [
        "322",
        0
      ],
      "mask": [
        "190",
        0
      ]
    },
    "class_type": "Cut By Mask",
    "_meta": {
      "title": "Cut By Mask"
    }
  },
  "259": {
    "inputs": {
      "use_zero_init": true,
      "zero_init_steps": 0,
      "model": [
        "89",
        0
      ]
    },
    "class_type": "CFGZeroStarAndInit",
    "_meta": {
      "title": "CFG Zero Star/Init"
    }
  },
  "275": {
    "inputs": {
      "select": 1,
      "sel_mode": false,
      "input1": [
        "96",
        0
      ]
    },
    "class_type": "ImpactSwitch",
    "_meta": {
      "title": "Choose upscale method"
    }
  },
  "283": {
    "inputs": {
      "filename_prefix": "upscaled",
      "images": [
        "140",
        0
      ]
    },
    "class_type": "SaveImage",
    "_meta": {
      "title": "Save Image"
    }
  },
  "290": {
    "inputs": {
      "model": "MiaoshouAI/Florence-2-large-PromptGen-v2.0",
      "precision": "fp16",
      "attention": "flash_attention_2",
      "convert_to_safetensors": false
    },
    "class_type": "DownloadAndLoadFlorence2Model",
    "_meta": {
      "title": "DownloadAndLoadFlorence2Model"
    }
  },
  "297": {
    "inputs": {
      "unet_name": "flux1-dev.safetensors",
      "weight_dtype": "default"
    },
    "class_type": "UNETLoader",
    "_meta": {
      "title": "Load Diffusion Model"
    }
  },
  "298": {
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
  "299": {
    "inputs": {
      "double_layers": "10",
      "single_layers": "3,4",
      "scale": 3,
      "start_percent": 0.010000000000000002,
      "end_percent": 0.15000000000000002,
      "rescaling_scale": 0,
      "model": [
        "297",
        0
      ]
    },
    "class_type": "SkipLayerGuidanceDiT",
    "_meta": {
      "title": "SkipLayerGuidanceDiT"
    }
  },
  "300": {
    "inputs": {
      "lora_name": "42lux-UltimateAtHome-flux-highresfix.safetensors",
      "strength_model": 0.9800000000000002,
      "model": [
        "299",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
    }
  },
  "301": {
    "inputs": {
      "lora_name": "Samsung_UltraReal.safetensors",
      "strength_model": 0.6000000000000001,
      "model": [
        "300",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
    }
  },
  "302": {
    "inputs": {
      "lora_name": "IDunnohowtonameLora.safetensors",
      "strength_model": 0.5000000000000001,
      "model": [
        "301",
        0
      ]
    },
    "class_type": "LoraLoaderModelOnly",
    "_meta": {
      "title": "LoraLoaderModelOnly"
    }
  },
  "303": {
    "inputs": {
      "model": [
        "302",
        0
      ]
    },
    "class_type": "ConfigureModifiedFlux",
    "_meta": {
      "title": "Configure Modified Flux"
    }
  },
  "304": {
    "inputs": {
      "scale": 1.75,
      "rescale": 0,
      "model": [
        "303",
        0
      ]
    },
    "class_type": "PAGAttention",
    "_meta": {
      "title": "Apply Flux PAG Attention"
    }
  },
  "316": {
    "inputs": {
      "value": 0.5
    },
    "class_type": "PrimitiveFloat",
    "_meta": {
      "title": "UPSCALER RATIO - ( CONSSIDER THE IMAGE AT THIS PIOINT IS ALREADY X4)"
    }
  },
  "317": {
    "inputs": {
      "value": 0.4
    },
    "class_type": "PrimitiveFloat",
    "_meta": {
      "title": "denoise_value (for now let's use this fixed value of 0.4 - but let's expose it in the edge function - so we can change it as a variable)"
    }
  },
  "318": {
    "inputs": {
      "value": 1,
      "width": [
        "319",
        0
      ],
      "height": [
        "319",
        1
      ]
    },
    "class_type": "SolidMask",
    "_meta": {
      "title": "SolidMask"
    }
  },
  "319": {
    "inputs": {
      "image": [
        "149",
        0
      ]
    },
    "class_type": "Get Image Size",
    "_meta": {
      "title": "Get Image Size"
    }
  },
  "322": {
    "inputs": {
      "mask": [
        "318",
        0
      ]
    },
    "class_type": "MaskToImage",
    "_meta": {
      "title": "Convert Mask to Image"
    }
  }
}`;

const FINAL_OUTPUT_NODE_ID = "283";
const FALLBACK_NODE_IDS = ["213", "9", "4"];

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

async function findOutputImage(historyOutputs: any): Promise<any | null> {
    if (!historyOutputs) return null;
    const nodesToCheck = [FINAL_OUTPUT_NODE_ID, ...FALLBACK_NODE_IDS];
    for (const nodeId of nodesToCheck) {
        const nodeOutput = historyOutputs[nodeId];
        if (nodeOutput?.images && Array.isArray(nodeOutput.images) && nodeOutput.images.length > 0) {
            return nodeOutput.images[0];
        }
    }
    for (const nodeId in historyOutputs) {
        const outputData = historyOutputs[nodeId];
        if (outputData.images && Array.isArray(outputData.images) && outputData.images.length > 0) {
            return outputData.images[0];
        }
    }
    return null;
}

async function createGalleryEntry(supabase: any, job: any, finalResult: any) {
    if (!job.metadata?.invoker_user_id || !job.metadata?.original_prompt_for_gallery) return;
    const jobPayload = {
        user_id: job.metadata.invoker_user_id,
        original_prompt: job.metadata.original_prompt_for_gallery,
        status: 'complete',
        final_result: { isImageGeneration: true, images: [finalResult] },
        context: { source: 'refiner' }
    };
    await supabase.from('mira-agent-jobs').insert(jobPayload);
}

async function wakeUpMainAgent(supabase: any, comfyJob: any, finalResult: any) {
    if (!comfyJob.main_agent_job_id) return;
    const { data: mainJob, error: fetchError } = await supabase.from('mira-agent-jobs').select('context').eq('id', comfyJob.main_agent_job_id).single();
    if (fetchError) { console.error(`[Poller] Could not fetch parent agent job:`, fetchError); return; }
    const newHistory = [
        ...(mainJob.context?.history || []),
        { role: 'function', parts: [{ functionResponse: { name: 'dispatch_to_refinement_agent', response: { isImageGeneration: true, images: [finalResult] } } }] }
    ];
    await supabase.from('mira-agent-jobs').update({
        status: 'processing',
        final_result: null,
        context: { ...mainJob.context, history: newHistory }
    }).eq('id', comfyJob.main_agent_job_id);
    supabase.functions.invoke('MIRA-AGENT-master-worker', { body: { job_id: comfyJob.main_agent_job_id } }).catch(console.error);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[ModelGenPoller][${job_id}] Poller invoked.`);

  try {
    await supabase.from('mira-agent-model-generation-jobs').update({ last_polled_at: new Date().toISOString() }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('*').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    switch (job.status) {
        case 'pending':
            await handlePendingState(supabase, job);
            break;
        case 'base_generation_complete':
            await handleBaseGenerationCompleteState(supabase, job);
            break;
        case 'generating_poses':
            await handleGeneratingPosesState(supabase, job);
            break;
        case 'polling_poses':
            await handlePollingPosesState(supabase, job);
            break;
        case 'upscaling_poses':
            await handleUpscalingPosesState(supabase, job);
            break;
        case 'awaiting_approval':
        case 'complete':
        case 'failed':
            console.log(`[ModelGenPoller][${job.id}] Job in terminal or waiting state ('${job.status}'). Halting.`);
            break;
        default:
            console.warn(`[ModelGenPoller][${job.id}] Unknown job status: ${job.status}`);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[ModelGenPoller][${job.id}] Error:`, error);
    await supabase.from('mira-agent-model-generation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});

async function handlePendingState(supabase: any, job: any) {
    console.log(`[ModelGenPoller][${job.id}] State: PENDING. Generating base prompt...`);
    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-generate-model-prompt', {
        body: { model_description: job.model_description, set_description: job.set_description }
    });
    if (promptError) throw new Error(`Prompt generation failed: ${promptError.message}`);
    const finalPrompt = promptData.final_prompt;

    console.log(`[ModelGenPoller][${job.id}] Base prompt generated. Generating 4 base images...`);
    const { data: modelDetails, error: modelError } = await supabase.from('mira-agent-models').select('provider').eq('model_id_string', job.context.selectedModelId).single();
    if (modelError) throw new Error(`Could not find model details for ${job.context.selectedModelId}`);
    
    const provider = modelDetails.provider.toLowerCase().replace(/[^a-z0-9.-]/g, '');
    const imageGenTool = provider === 'google' ? 'MIRA-AGENT-tool-generate-image-google' : 'MIRA-AGENT-tool-generate-image-fal-seedream';

    const { data: generationResult, error: generationError } = await supabase.functions.invoke(imageGenTool, {
        body: {
            prompt: finalPrompt,
            number_of_images: 4,
            model_id: job.context.selectedModelId,
            invoker_user_id: job.user_id,
            size: '1024x1024'
        }
    });
    if (generationError) throw new Error(`Image generation failed: ${generationError.message}`);

    await supabase.from('mira-agent-model-generation-jobs').update({
        status: 'base_generation_complete',
        base_generation_results: generationResult.images.map((img: any) => ({ id: img.storagePath, url: img.publicUrl }))
    }).eq('id', job.id);

    console.log(`[ModelGenPoller][${job.id}] Base images generated. Re-invoking poller.`);
    supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
}

async function handleBaseGenerationCompleteState(supabase: any, job: any) {
    console.log(`[ModelGenPoller][${job.id}] State: BASE_GENERATION_COMPLETE.`);
    if (job.auto_approve) {
        console.log(`[ModelGenPoller][${job.id}] Auto-approving best image...`);
        const { data: qaData, error: qaError } = await supabase.functions.invoke('MIRA-AGENT-tool-quality-assurance-model', {
            body: { 
                image_urls: job.base_generation_results.map((img: any) => img.url),
                model_description: job.model_description,
                set_description: job.set_description
            }
        });
        if (qaError) throw new Error(`Quality assurance failed: ${qaError.message}`);
        
        const bestImage = job.base_generation_results[qaData.best_image_index];
        await supabase.from('mira-agent-model-generation-jobs').update({
            status: 'generating_poses',
            base_model_image_url: bestImage.url
        }).eq('id', job.id);
        
        console.log(`[ModelGenPoller][${job.id}] AI selected image. Re-invoking poller to generate poses.`);
        supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
    } else {
        console.log(`[ModelGenPoller][${job.id}] Awaiting manual user approval.`);
        await supabase.from('mira-agent-model-generation-jobs').update({ status: 'awaiting_approval' }).eq('id', job.id);
    }
}

async function handleGeneratingPosesState(supabase: any, job: any) {
    console.log(`[ModelGenPoller][${job.id}] State: GENERATING_POSES.`);
    const poseJobs = [];
    for (const pose of job.pose_prompts) {
        const payload = {
            base_model_url: job.base_model_image_url,
            pose_prompt: pose.value,
            pose_image_url: pose.type === 'image' ? pose.value : null,
        };
        const { data: result, error } = await supabase.functions.invoke('MIRA-AGENT-tool-comfyui-pose-generator', { body: payload });
        if (error) throw error;
        poseJobs.push({
            pose_prompt: pose.value,
            comfyui_prompt_id: result.comfyui_prompt_id,
            status: 'processing',
            final_url: null,
            is_upscaled: false,
        });
    }
    await supabase.from('mira-agent-model-generation-jobs').update({ 
        status: 'polling_poses', 
        final_posed_images: poseJobs 
    }).eq('id', job.id);
    
    console.log(`[ModelGenPoller][${job.id}] All pose jobs dispatched. Re-invoking poller to start polling.`);
    supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
}

async function handlePollingPosesState(supabase: any, job: any) {
    console.log(`[ModelGenPoller][${job.id}] State: POLLING_POSES.`);
    let allComplete = true;
    let hasChanged = false;
    const updatedPoseJobs = [...job.final_posed_images];
    const comfyUiAddress = COMFYUI_ENDPOINT_URL!.replace(/\/+$/, "");
    const queueUrl = `${comfyUiAddress}/queue`;
    const queueResponse = await fetch(queueUrl);
    const queueData = await queueResponse.json();

    for (const [index, poseJob] of updatedPoseJobs.entries()) {
        if (poseJob.status === 'complete' || poseJob.status === 'failed') continue;

        allComplete = false;

        const isJobInQueue = queueData.queue_running.some((item: any) => item[1] === poseJob.comfyui_prompt_id) || 
                             queueData.queue_pending.some((item: any) => item[1] === poseJob.comfyui_prompt_id);

        if (isJobInQueue) {
            console.log(`[ModelGenPoller][${job.id}] Pose job ${poseJob.comfyui_prompt_id} is still in queue. Continuing to poll.`);
            continue;
        }

        const historyUrl = `${comfyUiAddress}/history/${poseJob.comfyui_prompt_id}`;
        const historyResponse = await fetch(historyUrl);
        
        if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            const promptHistory = historyData[poseJob.comfyui_prompt_id];
            const outputNode = promptHistory?.outputs['213'] || promptHistory?.outputs['9'];
            if (outputNode?.images && outputNode.images.length > 0) {
                const image = outputNode.images[0];
                const tempImageUrl = `${comfyUiAddress}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${image.type}`;
                
                console.log(`[ModelGenPoller][${job.id}] Pose job ${poseJob.comfyui_prompt_id} is complete. Downloading from ComfyUI...`);
                const imageResponse = await fetch(tempImageUrl);
                if (!imageResponse.ok) throw new Error(`Failed to download final pose image from ComfyUI: ${imageResponse.statusText}`);
                const imageBuffer = await imageResponse.arrayBuffer();

                const filePath = `${job.user_id}/model-poses/${Date.now()}_${image.filename}`;
                await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
                const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

                updatedPoseJobs[index].status = 'complete';
                updatedPoseJobs[index].final_url = publicUrl;
                updatedPoseJobs[index].is_upscaled = false;
                hasChanged = true;
                console.log(`[ModelGenPoller][${job.id}] Pose job complete. Stored at Supabase URL: ${publicUrl}`);
            } else {
                // Finished but no output -> failed
                console.warn(`[ModelGenPoller][${job.id}] Pose job ${poseJob.comfyui_prompt_id} finished with no output. Attempting retry.`);
                const currentRetries = poseJob.retry_count || 0;
                if (currentRetries < MAX_RETRIES) {
                    const pose = job.pose_prompts[index];
                    const { data: result, error } = await supabase.functions.invoke('MIRA-AGENT-tool-comfyui-pose-generator', { body: { base_model_url: job.base_model_image_url, pose_prompt: pose.value, pose_image_url: pose.type === 'image' ? pose.value : null } });
                    if (error) {
                        updatedPoseJobs[index].status = 'failed';
                        updatedPoseJobs[index].error_message = `Retry failed: ${error.message}`;
                    } else {
                        updatedPoseJobs[index].comfyui_prompt_id = result.comfyui_prompt_id;
                        updatedPoseJobs[index].status = 'processing';
                        updatedPoseJobs[index].retry_count = currentRetries + 1;
                    }
                } else {
                    updatedPoseJobs[index].status = 'failed';
                    updatedPoseJobs[index].error_message = 'Job failed after max retries.';
                }
                hasChanged = true;
            }
        } else {
            console.error(`[ModelGenPoller][${job.id}] Pose job ${poseJob.comfyui_prompt_id} not found in queue or history. Marking as failed.`);
            updatedPoseJobs[index].status = 'failed';
            updatedPoseJobs[index].error_message = 'Job not found in ComfyUI history.';
            hasChanged = true;
        }
    }

    if (updatedPoseJobs.some(p => p.status === 'failed')) {
        console.error(`[ModelGenPoller][${job.id}] At least one pose failed permanently. Failing the entire job.`);
        await supabase.from('mira-agent-model-generation-jobs').update({ status: 'failed', error_message: 'One or more poses failed to generate.', final_posed_images: updatedPoseJobs }).eq('id', job.id);
        return;
    }

    if (allComplete) {
        console.log(`[ModelGenPoller][${job.id}] All pose jobs are complete. Finalizing main job.`);
        await supabase.from('mira-agent-model-generation-jobs').update({ status: 'complete', final_posed_images: updatedPoseJobs }).eq('id', job.id);
    } else {
        if (hasChanged) {
            await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoseJobs }).eq('id', job.id);
        }
        console.log(`[ModelGenPoller][${job.id}] Not all pose jobs are complete. Re-polling.`);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
    }
}

async function pollUpscalingPoses(supabase: any, job: any) {
    const updatedPoseJobs = [...job.final_posed_images];
    let hasChanged = false;
    const comfyUiAddress = COMFYUI_ENDPOINT_URL!.replace(/\/+$/, "");

    for (const [index, poseJob] of updatedPoseJobs.entries()) {
        if (poseJob.upscale_status !== 'processing' || !poseJob.upscale_prompt_id) continue;

        const historyUrl = `${comfyUiAddress}/history/${poseJob.upscale_prompt_id}`;
        const historyResponse = await fetch(historyUrl);
        
        if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            const promptHistory = historyData[poseJob.upscale_prompt_id];
            const outputNode = await findOutputImage(promptHistory?.outputs);
            if (outputNode) {
                const image = outputNode;
                const tempImageUrl = `${comfyUiAddress}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${image.type}`;
                
                console.log(`[ModelGenPoller][${job.id}] Pose successfully upscaled. Downloading from ComfyUI...`);
                const imageResponse = await fetch(tempImageUrl);
                if (!imageResponse.ok) throw new Error(`Failed to download upscaled image from ComfyUI: ${imageResponse.statusText}`);
                const imageBuffer = await imageResponse.arrayBuffer();

                const filePath = `${job.user_id}/model-poses-upscaled/${Date.now()}_${image.filename}`;
                await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
                const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

                updatedPoseJobs[index].final_url = publicUrl;
                updatedPoseJobs[index].is_upscaled = true;
                updatedPoseJobs[index].upscale_status = 'complete';
                hasChanged = true;
                console.log(`[ModelGenPoller][${job.id}] Pose successfully upscaled. Stored at Supabase URL: ${publicUrl}`);
            }
        }
    }

    if (hasChanged) {
        await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoseJobs }).eq('id', job.id);
    }
}

async function handleUpscalingPosesState(supabase: any, job: any) {
    console.log(`[ModelGenPoller][${job.id}] State: UPSCALING_POSES.`);
    
    await pollUpscalingPoses(supabase, job);

    const { data: updatedJob, error: refetchError } = await supabase.from('mira-agent-model-generation-jobs').select('*').eq('id', job.id).single();
    if (refetchError) throw refetchError;

    const posesToProcess = (updatedJob.final_posed_images || []).filter((p: any) => p.upscale_status === 'pending');

    if (posesToProcess.length > 0) {
        console.log(`[ModelGenPoller][${job.id}] Found ${posesToProcess.length} poses pending upscale. Dispatching all.`);

        const originalPoses = [...updatedJob.final_posed_images];
        const posesToUpdate = originalPoses.map(p => {
            if (posesToProcess.some((ptp: any) => ptp.final_url === p.final_url)) {
                return { ...p, upscale_status: 'processing' };
            }
            return p;
        });

        await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: posesToUpdate }).eq('id', job.id);

        const comfyUiAddress = COMFYUI_ENDPOINT_URL!.replace(/\/+$/, "");
        const upscalePromises = posesToProcess.map(async (poseToProcess: any, index: number) => {
            try {
                const imageResponse = await fetch(poseToProcess.final_url);
                if (!imageResponse.ok) throw new Error(`Failed to download image for upscaling: ${imageResponse.statusText}`);
                const imageBlob = await imageResponse.blob();

                const uniqueFilename = `pose_to_upscale_${job.id}_${index}.png`;
                const uploadedFilename = await uploadImageToComfyUI(comfyUiAddress, imageBlob, uniqueFilename);

                const workflow = JSON.parse(tiledUpscalerWorkflow);
                workflow['149'].inputs.image = uploadedFilename;
                const upscaleFactor = poseToProcess.upscale_factor || 1.5;
                const secondaryScaleFactor = upscaleFactor / 4.0;
                workflow['316'].inputs.value = secondaryScaleFactor;
                workflow['115'].inputs.seed = Math.floor(Math.random() * 1e15);

                const queueResponse = await fetch(`${comfyUiAddress}/prompt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prompt: workflow })
                });
                if (!queueResponse.ok) throw new Error(`ComfyUI queue request failed: ${await queueResponse.text()}`);
                const queueData = await queueResponse.json();
                
                return { final_url: poseToProcess.final_url, upscale_prompt_id: queueData.prompt_id, success: true };
            } catch (error) {
                console.error(`[ModelGenPoller][${job.id}] Failed to start upscale for pose ${poseToProcess.pose_prompt}:`, error.message);
                return { final_url: poseToProcess.final_url, error_message: error.message, success: false };
            }
        });

        const results = await Promise.allSettled(upscalePromises);

        const finalPoseData = [...posesToUpdate];
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                const poseIndex = finalPoseData.findIndex(p => p.final_url === result.value.final_url);
                if (poseIndex !== -1) {
                    if (result.value.success) {
                        finalPoseData[poseIndex].upscale_prompt_id = result.value.upscale_prompt_id;
                    } else {
                        finalPoseData[poseIndex].upscale_status = 'failed';
                        finalPoseData[poseIndex].error_message = result.value.error_message;
                    }
                }
            }
        });
        await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: finalPoseData }).eq('id', job.id);
    }

    const { data: finalJobState } = await supabase.from('mira-agent-model-generation-jobs').select('final_posed_images').eq('id', job.id).single();
    const isStillProcessing = (finalJobState?.final_posed_images || []).some((p: any) => p.upscale_status === 'processing');
    
    if (!isStillProcessing) {
        console.log(`[ModelGenPoller][${job.id}] All upscaling jobs are complete or failed. Setting main job status to complete.`);
        await supabase.from('mira-agent-model-generation-jobs').update({ status: 'complete' }).eq('id', job.id);
    } else {
        console.log(`[ModelGenPoller][${job.id}] Still waiting for upscaling jobs to complete. Re-polling.`);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
    }
}