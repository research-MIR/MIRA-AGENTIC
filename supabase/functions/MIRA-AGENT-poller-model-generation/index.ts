import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
const FAL_KEY = Deno.env.get('FAL_KEY');
const POLLING_INTERVAL_MS = 5000;
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const MAX_RETRIES = 2;
const MAX_BASE_MODEL_RETRIES = 2;
const RETRY_DELAY_MS = 5000;
const ANALYSIS_STALLED_THRESHOLD_SECONDS = 60;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const tiledUpscalerWorkflow = `{
  "10": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader" },
  "48": { "inputs": { "clip_l": "", "t5xxl": "", "guidance": 2, "clip": ["298", 0] }, "class_type": "CLIPTextEncodeFlux" },
  "49": { "inputs": { "conditioning": ["48", 0] }, "class_type": "ConditioningZeroOut" },
  "87": { "inputs": { "text": ["171", 2], "clip": ["298", 0] }, "class_type": "CLIPTextEncode" },
  "88": { "inputs": { "guidance": 3.5, "conditioning": ["87", 0] }, "class_type": "FluxGuidance" },
  "89": { "inputs": { "max_shift": 1.15, "base_shift": 0.5, "width": 1024, "height": 1024, "model": ["304", 0] }, "class_type": "ModelSamplingFlux" },
  "91": { "inputs": { "strength": 0.8500000000000002, "start_percent": 0, "end_percent": 0.8500000000000002, "positive": ["88", 0], "negative": ["49", 0], "control_net": ["93", 0], "image": ["152", 0], "vae": ["10", 0] }, "class_type": "ControlNetApplyAdvanced" },
  "93": { "inputs": { "control_net_name": "fluxcontrolnetupscale.safetensors" }, "class_type": "ControlNetLoader" },
  "96": { "inputs": { "upscale_method": "bicubic", "scale_by": ["316", 0], "image": ["148", 0] }, "class_type": "ImageScaleBy" },
  "115": { "inputs": { "seed": 622487950833006, "steps": 20, "cfg": 1, "sampler_name": "euler", "scheduler": "simple", "denoise": ["317", 0], "model": ["259", 0], "positive": ["91", 0], "negative": ["91", 1], "latent_image": ["118", 0] }, "class_type": "KSampler" },
  "116": { "inputs": { "pixels": ["152", 0], "vae": ["10", 0] }, "class_type": "VAEEncode" },
  "118": { "inputs": { "samples": ["116", 0], "mask": ["152", 1] }, "class_type": "SetLatentNoiseMask" },
  "140": { "inputs": { "blend": 128, "images": ["158", 0], "tile_calc": ["150", 1] }, "class_type": "DynamicTileMerge" },
  "142": { "inputs": { "samples": ["115", 0], "vae": ["10", 0] }, "class_type": "VAEDecode" },
  "148": { "inputs": { "image": ["160", 0], "alpha": ["178", 0] }, "class_type": "JoinImageWithAlpha" },
  "149": { "inputs": { "image": "placeholder.png" }, "class_type": "LoadImage" },
  "150": { "inputs": { "tile_width": 1024, "tile_height": 1024, "overlap": 264, "offset": 0, "image": ["275", 0] }, "class_type": "DynamicTileSplit" },
  "151": { "inputs": { "image": ["150", 0] }, "class_type": "ImpactImageBatchToImageList" },
  "152": { "inputs": { "image": ["151", 0] }, "class_type": "SplitImageWithAlpha" },
  "158": { "inputs": { "images": ["142", 0] }, "class_type": "ImageListToImageBatch" },
  "160": { "inputs": { "upscale_model": ["161", 0], "image": ["204", 0] }, "class_type": "ImageUpscaleWithModel" },
  "161": { "inputs": { "model_name": "4x-UltraSharpV2.safetensors" }, "class_type": "UpscaleModelLoader" },
  "171": { "inputs": { "text_input": "", "task": "prompt_gen_mixed_caption_plus", "fill_mask": true, "keep_model_loaded": true, "max_new_tokens": 1024, "num_beams": 3, "do_sample": true, "output_mask_select": "", "seed": 1116563907150578, "image": ["152", 0], "florence2_model": ["290", 0] }, "class_type": "Florence2Run" },
  "178": { "inputs": { "channel": "red", "image": ["179", 0] }, "class_type": "ImageToMask" },
  "179": { "inputs": { "upscale_method": "nearest-exact", "scale_by": 4.0, "image": ["236", 0] }, "class_type": "ImageScaleBy" },
  "190": { "inputs": { "padding": 16, "constraints": "ignore", "constraint_x": ["219", 0], "constraint_y": ["219", 1], "min_width": 0, "min_height": 0, "batch_behavior": "match_ratio", "mask": ["322", 0] }, "class_type": "Mask To Region" },
  "192": { "inputs": { "force_resize_width": 0, "force_resize_height": 0, "image": ["149", 0], "mask": ["190", 0] }, "class_type": "Cut By Mask" },
  "204": { "inputs": { "kind": "RGB", "image": ["192", 0] }, "class_type": "Change Channel Count" },
  "219": { "inputs": { "image": ["322", 0] }, "class_type": "Get Image Size" },
  "234": { "inputs": { "method": "intensity", "image": ["236", 0] }, "class_type": "Image To Mask" },
  "236": { "inputs": { "force_resize_width": 0, "force_resize_height": 0, "image": ["322", 0], "mask": ["190", 0] }, "class_type": "Cut By Mask" },
  "259": { "inputs": { "use_zero_init": true, "zero_init_steps": 0, "model": ["89", 0] }, "class_type": "CFGZeroStarAndInit" },
  "275": { "inputs": { "select": 1, "sel_mode": false, "input1": ["96", 0] }, "class_type": "ImpactSwitch" },
  "283": { "inputs": { "filename_prefix": "upscaled", "images": ["140", 0] }, "class_type": "SaveImage" },
  "290": { "inputs": { "model": "MiaoshouAI/Florence-2-large-PromptGen-v2.0", "precision": "fp16", "attention": "flash_attention_2", "convert_to_safetensors": false }, "class_type": "DownloadAndLoadFlorence2Model" },
  "297": { "inputs": { "unet_name": "flux1-dev.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader" },
  "298": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader" },
  "299": { "inputs": { "double_layers": "10", "single_layers": "3,4", "scale": 3, "start_percent": 0.01, "end_percent": 0.15, "rescaling_scale": 0, "model": ["297", 0] }, "class_type": "SkipLayerGuidanceDiT" },
  "300": { "inputs": { "lora_name": "42lux-UltimateAtHome-flux-highresfix.safetensors", "strength_model": 0.98, "model": ["299", 0] }, "class_type": "LoraLoaderModelOnly" },
  "301": { "inputs": { "lora_name": "Samsung_UltraReal.safetensors", "strength_model": 0.6, "model": ["300", 0] }, "class_type": "LoraLoaderModelOnly" },
  "302": { "inputs": { "lora_name": "IDunnohowtonameLora.safetensors", "strength_model": 0.5, "model": ["301", 0] }, "class_type": "LoraLoaderModelOnly" },
  "303": { "inputs": { "model": ["302", 0] }, "class_type": "ConfigureModifiedFlux" },
  "304": { "inputs": { "scale": 1.75, "rescale": 0, "model": ["303", 0] }, "class_type": "PAGAttention" },
  "316": { "inputs": { "value": 0.5 }, "class_type": "PrimitiveFloat" },
  "317": { "inputs": { "value": 0.4 }, "class_type": "PrimitiveFloat" },
  "318": { "inputs": { "value": 1, "width": ["319", 0], "height": ["319", 1] }, "class_type": "SolidMask" },
  "319": { "inputs": { "image": ["149", 0] }, "class_type": "Get Image Size" },
  "322": { "inputs": { "mask": ["318", 0] }, "class_type": "MaskToImage" }
}`;

const FINAL_OUTPUT_NODE_ID_UPSCALE = "283";
const FALLBACK_NODE_IDS_UPSCALE = ["431", "430", "9", "4"];

const FINAL_OUTPUT_NODE_ID_POSE = "9";
const FALLBACK_NODE_IDS_POSE = ["213", "4"];

async function uploadImageToComfyUI(comfyUiUrl: string, imageBlob: Blob, filename: string) {
  const formData = new FormData();
  formData.append('image', imageBlob, filename);
  formData.append('overwrite', 'true');
  const uploadUrl = `${comfyUiUrl}/upload/image`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: formData
  });
  if (!response.ok) throw new Error(`ComfyUI upload failed: ${await response.text()}`);
  const data = await response.json();
  if (!data.name) throw new Error("ComfyUI did not return a filename for the uploaded image.");
  return data.name;
}

async function findOutputImage(historyOutputs: any, primaryNodeId: string, fallbackNodeIds: string[]): Promise<any | null> {
    if (!historyOutputs) return null;
    const nodesToCheck = [primaryNodeId, ...fallbackNodeIds];
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
  console.log(`[ModelGenPoller][${job_id}] Poller v1.2.0 invoked.`);
  let job: any = null;

  try {
    await supabase.from('mira-agent-model-generation-jobs').update({ last_polled_at: new Date().toISOString() }).eq('id', job_id);

    const { data: fetchedJob, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('*').eq('id', job_id).single();
    if (fetchError) throw fetchError;
    job = fetchedJob;

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
    console.error(`[ModelGenPoller][${job_id}] ERROR:`, error);
    await supabase.from('mira-agent-model-generation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});

async function handlePendingState(supabase: any, job: any) {
    const logPrefix = `[ModelGenPoller][${job.id}]`;
    console.log(`${logPrefix} State: PENDING. Generating base model candidates...`);
    console.log(`${logPrefix} Full job context:`, JSON.stringify(job.context, null, 2));

    const selectedModelId = job.context?.selectedModelId;
    if (!selectedModelId) throw new Error("No model selected in job context.");
    const { data: modelDetails } = await supabase.from('mira-agent-models').select('provider').eq('model_id_string', selectedModelId).single();
    const provider = modelDetails?.provider.toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'google';

    let totalNeededImages = 2; // Default for fal.ai
    if (provider === 'google') {
        totalNeededImages = 4;
    } else if (selectedModelId === 'fal-ai/flux/krea') {
        totalNeededImages = 4;
    }
    
    const existingImages = job.base_generation_results || [];
    const neededImages = totalNeededImages - existingImages.length;

    if (neededImages <= 0) {
        console.log(`${logPrefix} All ${totalNeededImages} base images already generated. Moving to next state.`);
        await supabase.from('mira-agent-model-generation-jobs').update({ status: 'base_generation_complete' }).eq('id', job.id);
        supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
        return;
    }

    console.log(`${logPrefix} Need to generate ${neededImages} more image(s).`);

    const finalPrompt = job.metadata?.final_prompt_used || (await supabase.functions.invoke('MIRA-AGENT-tool-generate-model-prompt', {
        body: { model_description: job.model_description, set_description: job.set_description }
    })).data.final_prompt;

    if (!job.metadata?.final_prompt_used) {
        await supabase.from('mira-agent-model-generation-jobs').update({ metadata: { ...job.metadata, final_prompt_used: finalPrompt } }).eq('id', job.id);
    }

    const aspectRatio = job.context?.aspect_ratio || '1024x1024';
    console.log(`${logPrefix} Aspect ratio from context: ${aspectRatio}`);
    
    let toolToInvoke = '';
    let payload: { [key: string]: any } = {
        prompt: finalPrompt,
        number_of_images: 1,
        model_id: selectedModelId,
        invoker_user_id: job.user_id,
        seed: Math.floor(Math.random() * 1e15),
        source: 'model_pack_generator'
    };

    switch (selectedModelId) {
        case 'fal-ai/wan/v2.2-a14b/text-to-image':
            toolToInvoke = 'MIRA-AGENT-tool-generate-image-fal-wan';
            break;
        case 'fal-ai/flux/krea':
            toolToInvoke = 'MIRA-AGENT-tool-generate-image-fal-krea';
            break;
        default:
            if (provider === 'fal.ai') {
                toolToInvoke = 'MIRA-AGENT-tool-generate-image-fal-seedream';
            } else if (provider === 'google') {
                toolToInvoke = 'MIRA-AGENT-tool-generate-image-google';
            } else {
                throw new Error(`Unsupported provider '${provider}' for model generation.`);
            }
    }

    if (provider === 'google') {
        payload.size = aspectRatio;
    } else {
        payload.size = aspectRatio;
    }

    console.log(`${logPrefix} Using provider '${provider}', invoking tool '${toolToInvoke}' for one image.`);
    console.log(`${logPrefix} Final payload being sent to tool:`, JSON.stringify(payload, null, 2));

    const { data: generationResult, error: generationError } = await supabase.functions.invoke(toolToInvoke, {
        body: payload
    });
    if (generationError) throw new Error(`Image generation failed: ${generationError.message}`);
    
    const newImage = generationResult.images[0];
    const updatedImages = [...existingImages, { id: newImage.storagePath, url: newImage.publicUrl }];

    await supabase.from('mira-agent-model-generation-jobs').update({
        base_generation_results: updatedImages
    }).eq('id', job.id);
    
    console.log(`${logPrefix} Generated image ${updatedImages.length}/${totalNeededImages}. Re-invoking poller.`);
    supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
}

async function handleBaseGenerationCompleteState(supabase: any, job: any) {
  const logPrefix = `[ModelGenPoller][${job.id}]`;
  console.log(`${logPrefix} State: BASE_GENERATION_COMPLETE.`);

  if (job.auto_approve) {
    console.log(`${logPrefix} Auto-approving best image...`);

    let qaData = null;
    let lastQaError = null;

    for (let attempt = 1; attempt <= MAX_BASE_MODEL_RETRIES + 1; attempt++) {
        try {
            const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-quality-assurance-model', {
                body: {
                    image_urls: job.base_generation_results.map((img: any) => img.url),
                    model_description: job.model_description,
                    set_description: job.set_description,
                    final_generation_prompt: job.metadata?.final_prompt_used
                }
            });

            if (error) throw new Error(error.message || 'Function invocation failed with an unknown error.');
            
            qaData = data;
            lastQaError = null;
            break;
        } catch (error) {
            lastQaError = error;
            console.warn(`${logPrefix} QA tool invocation failed on attempt ${attempt}/${MAX_BASE_MODEL_RETRIES + 1}:`, error.message);
            if (attempt > MAX_BASE_MODEL_RETRIES) {
                break;
            }
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
            console.log(`${logPrefix} Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    if (lastQaError) {
        throw new Error(`Quality assurance failed after all retries: ${lastQaError.message}`);
    }

    if (!qaData) {
        throw new Error("Quality assurance tool returned no data after all retries.");
    }

    if (qaData.action === 'select') {
      console.log(`${logPrefix} QA check passed. Reason: "${qaData.reasoning}". Selecting image index ${qaData.best_image_index}.`);
      const bestImage = job.base_generation_results[qaData.best_image_index];
      await supabase.from('mira-agent-model-generation-jobs').update({
        status: 'generating_poses',
        base_model_image_url: bestImage.url,
        gender: qaData.gender
      }).eq('id', job.id);

      console.log(`${logPrefix} AI selected image and tagged gender as '${qaData.gender}'. Invoking analyzer to create Identity Passport.`);
      supabase.functions.invoke('MIRA-AGENT-analyzer-pose-image', {
        body: { job_id: job.id, base_model_image_url: bestImage.url }
      }).catch((err: any) => console.error(`${logPrefix} Failed to invoke Identity Passport creation:`, err));

      console.log(`${logPrefix} Re-invoking poller to proceed to 'generating_poses' state.`);
      supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);

    } else if (qaData.action === 'retry') {
      console.warn(`${logPrefix} QA check failed. Reason: "${qaData.reasoning}". Initiating retry.`);
      const currentRetries = job.metadata?.base_model_retry_count || 0;

      if (currentRetries < MAX_BASE_MODEL_RETRIES) {
        const newRetryCount = currentRetries + 1;
        console.log(`${logPrefix} Attempting retry ${newRetryCount}/${MAX_BASE_MODEL_RETRIES}. Resetting job to 'pending'.`);
        await supabase.from('mira-agent-model-generation-jobs').update({
          status: 'pending',
          base_generation_results: [],
          metadata: { ...job.metadata, base_model_retry_count: newRetryCount },
          error_message: `QA failed: ${qaData.reasoning}. Retrying...`
        }).eq('id', job.id);

        console.log(`${logPrefix} Job reset. Re-invoking poller to generate a new batch.`);
        supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
      } else {
        const finalErrorMessage = `Failed to generate a valid base model after ${MAX_BASE_MODEL_RETRIES + 1} attempts. Last reason: ${qaData.reasoning}`;
        console.error(`${logPrefix} ${finalErrorMessage}`);
        await supabase.from('mira-agent-model-generation-jobs').update({
          status: 'failed',
          error_message: finalErrorMessage
        }).eq('id', job.id);
      }
    } else {
      throw new Error(`QA tool returned an unknown action: '${qaData.action}'`);
    }
  } else {
    console.log(`${logPrefix} Awaiting manual user approval.`);
    await supabase.from('mira-agent-model-generation-jobs').update({
      status: 'awaiting_approval'
    }).eq('id', job.id);
  }
}

async function handleGeneratingPosesState(supabase: any, job: any) {
  console.log(`[ModelGenPoller][${job.id}] State: GENERATING_POSES.`);
  
  const basePose = {
    pose_prompt: "Neutral A-pose, frontal",
    comfyui_prompt_id: null,
    status: 'analyzing',
    final_url: job.base_model_image_url,
    is_upscaled: false,
    analysis_started_at: new Date().toISOString(),
    retry_count: 0,
    qa_history: []
  };

  const newPosePlaceholders = job.pose_prompts.map((pose: any) => ({
    pose_prompt: pose.value,
    comfyui_prompt_id: null,
    status: 'pending',
    final_url: null,
    is_upscaled: false,
    retry_count: 0,
    qa_history: []
  }));

  const finalPoseArray = [basePose, ...newPosePlaceholders];

  await supabase.from('mira-agent-model-generation-jobs').update({ 
    status: 'generating_poses',
    final_posed_images: finalPoseArray 
  }).eq('id', job.id);

  supabase.functions.invoke('MIRA-AGENT-analyzer-pose-image', {
    body: {
      job_id: job.id,
      image_url: job.base_model_image_url,
      base_model_image_url: job.base_model_image_url,
      pose_prompt: basePose.pose_prompt
    }
  }).catch(err => console.error(`[ModelGenPoller][${job.id}] ERROR: Failed to invoke analyzer for base pose:`, err));

  const poseGenerationPromises = job.pose_prompts.map((pose: any) => {
    const payload = {
      job_id: job.id,
      base_model_url: job.base_model_image_url,
      pose_prompt: pose.value,
      pose_image_url: pose.type === 'image' ? pose.value : null,
    };
    return supabase.functions.invoke('MIRA-AGENT-tool-comfyui-pose-generator', { body: payload });
  });

  Promise.allSettled(poseGenerationPromises).then(results => {
    const failedCount = results.filter(r => r.status === 'rejected').length;
    if (failedCount > 0) {
      console.error(`[ModelGenPoller][${job.id}] Failed to dispatch ${failedCount} pose generation jobs.`);
    } else {
      console.log(`[ModelGenPoller][${job.id}] All ${job.pose_prompts.length} pose generation jobs dispatched successfully.`);
    }
    
    supabase.from('mira-agent-model-generation-jobs').update({ status: 'polling_poses' })
      .eq('id', job.id)
      .then(() => {
        console.log(`[ModelGenPoller][${job.id}] Status updated to polling_poses. Re-invoking poller.`);
        supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
      });
  });
}

async function handlePollingPosesState(supabase: any, job: any) {
    const logPrefix = `[ModelGenPoller][${job.id}]`;
    console.log(`${logPrefix} State: POLLING_POSES.`);
    
    let hasChanged = false;
    const updatedPoseJobs = [...job.final_posed_images];
    const comfyUiAddress = COMFYUI_ENDPOINT_URL!.replace(/\/+$/, "");
    const queueUrl = `${comfyUiAddress}/queue`;
    const queueResponse = await fetch(queueUrl);
    const queueData = await queueResponse.json();

    for (const [index, poseJob] of updatedPoseJobs.entries()) {
        if (poseJob.status === 'complete' || (poseJob.status === 'failed' && (poseJob.retry_count || 0) >= MAX_RETRIES)) {
            continue;
        }

        if (poseJob.status === 'pending') {
            console.log(`${logPrefix} Found pending pose "${poseJob.pose_prompt}". Dispatching to generator.`);
            updatedPoseJobs[index].status = 'processing'; 
            hasChanged = true;
            supabase.functions.invoke('MIRA-AGENT-tool-comfyui-pose-generator', {
                body: {
                    job_id: job.id,
                    base_model_url: job.base_model_image_url,
                    pose_prompt: poseJob.pose_prompt,
                    pose_image_url: null,
                }
            }).catch(err => {
                console.error(`${logPrefix} ERROR: Failed to dispatch generator for pending pose:`, err);
            });
            continue;
        }

        if (poseJob.status === 'failed' && (poseJob.retry_count || 0) < MAX_RETRIES) {
            const newRetryCount = (poseJob.retry_count || 0) + 1;
            console.log(`${logPrefix} Auto-retrying failed pose "${poseJob.pose_prompt}" (Attempt ${newRetryCount}/${MAX_RETRIES}). Setting to pending.`);
            updatedPoseJobs[index].status = 'pending';
            updatedPoseJobs[index].retry_count = newRetryCount;
            updatedPoseJobs[index].last_retry_type = 'automatic';
            hasChanged = true;
            continue;
        }

        if (poseJob.status === 'analyzing') {
            const analysisStartedAt = poseJob.analysis_started_at ? new Date(poseJob.analysis_started_at).getTime() : 0;
            const now = Date.now();
            const secondsSinceStart = (now - analysisStartedAt) / 1000;
            if (secondsSinceStart > ANALYSIS_STALLED_THRESHOLD_SECONDS) {
                console.warn(`${logPrefix} STALL DETECTED: Pose analysis for "${poseJob.pose_prompt}" has been running for over ${ANALYSIS_STALLED_THRESHOLD_SECONDS}s. Re-triggering analyzer.`);
                updatedPoseJobs[index].analysis_started_at = new Date().toISOString();
                hasChanged = true;
                supabase.functions.invoke('MIRA-AGENT-analyzer-pose-image', {
                    body: {
                        job_id: job.id,
                        image_url: poseJob.final_url,
                        base_model_image_url: job.base_model_image_url,
                        pose_prompt: poseJob.pose_prompt
                    }
                }).catch(err => console.error(`${logPrefix} ERROR: Failed to re-invoke analyzer for stalled pose:`, err));
            }
            continue;
        }

        if (poseJob.status === 'processing' && poseJob.comfyui_prompt_id) {
            const isJobInQueue = queueData.queue_running.some((item: any) => item[1] === poseJob.comfyui_prompt_id) || 
                                 queueData.queue_pending.some((item: any) => item[1] === poseJob.comfyui_prompt_id);
            if (isJobInQueue) continue;
            const historyUrl = `${comfyUiAddress}/history/${poseJob.comfyui_prompt_id}`;
            const historyResponse = await fetch(historyUrl);
            if (historyResponse.ok) {
                const historyData = await historyResponse.json();
                const promptHistory = historyData[poseJob.comfyui_prompt_id];
                const outputNode = await findOutputImage(promptHistory?.outputs, FINAL_OUTPUT_NODE_ID_POSE, FALLBACK_NODE_IDS_POSE);
                if (outputNode) {
                    const image = outputNode;
                    const tempImageUrl = `${comfyUiAddress}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${image.type}`;
                    const imageResponse = await fetch(tempImageUrl);
                    if (!imageResponse.ok) throw new Error(`Failed to download final pose image from ComfyUI: ${imageResponse.statusText}`);
                    const imageBuffer = await imageResponse.arrayBuffer();
                    const filePath = `${job.user_id}/model-poses/${Date.now()}_${image.filename}`;
                    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
                    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
                    updatedPoseJobs[index].status = 'analyzing';
                    updatedPoseJobs[index].final_url = publicUrl;
                    updatedPoseJobs[index].analysis_started_at = new Date().toISOString();
                    hasChanged = true;
                    supabase.functions.invoke('MIRA-AGENT-analyzer-pose-image', {
                        body: {
                            job_id: job.id,
                            image_url: publicUrl,
                            base_model_image_url: job.base_model_image_url,
                            pose_prompt: poseJob.pose_prompt
                        }
                    }).catch(err => console.error(`${logPrefix} ERROR: Failed to invoke analyzer for new pose:`, err));
                } else {
                    updatedPoseJobs[index].status = 'failed';
                    updatedPoseJobs[index].error_message = 'Job finished with no output.';
                    hasChanged = true;
                }
            } else {
                updatedPoseJobs[index].status = 'failed';
                updatedPoseJobs[index].error_message = 'Job not found in ComfyUI history.';
                hasChanged = true;
            }
        }
    }

    const isFullyFinished = updatedPoseJobs.every(p => p.status === 'complete' || (p.status === 'failed' && p.retry_count >= MAX_RETRIES));
    if (hasChanged || (isFullyFinished && job.status !== 'complete')) {
        const finalStatus = isFullyFinished ? 'complete' : job.status;
        await supabase.from('mira-agent-model-generation-jobs').update({ 
            final_posed_images: updatedPoseJobs,
            status: finalStatus 
        }).eq('id', job.id);
        if (finalStatus === 'complete') {
            console.log(`${logPrefix} All pose jobs are complete. Main job finalized.`);
        } else {
            console.log(`${logPrefix} DB updated. Re-invoking poller to continue.`);
            supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
        }
    } else {
        console.log(`${logPrefix} No changes detected in this polling cycle.`);
    }
}

async function pollUpscalingPoses(supabase: any, job: any) {
    const updatedPoseJobs = [...job.final_posed_images];
    let hasChanged = false;
    const comfyUiAddress = COMFYUI_ENDPOINT_URL!.replace(/\/+$/, "");
    const queueUrl = `${comfyUiAddress}/queue`;
    const queueResponse = await fetch(queueUrl);
    const queueData = await queueResponse.json();

    for (const [index, poseJob] of updatedPoseJobs.entries()) {
        if (poseJob.upscale_status !== 'processing' || !poseJob.upscale_prompt_id) continue;

        const isJobInQueue = queueData.queue_running.some((item: any) => item[1] === poseJob.upscale_prompt_id) || 
                             queueData.queue_pending.some((item: any) => item[1] === poseJob.upscale_prompt_id);

        if (isJobInQueue) {
            console.log(`[ModelGenPoller][${job.id}] Upscale job ${poseJob.upscale_prompt_id} is still in queue.`);
            continue;
        }

        const historyUrl = `${comfyUiAddress}/history/${poseJob.upscale_prompt_id}`;
        const historyResponse = await fetch(historyUrl);
        
        if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            const promptHistory = historyData[poseJob.upscale_prompt_id];
            const outputNode = await findOutputImage(promptHistory?.outputs, FINAL_OUTPUT_NODE_ID_UPSCALE, FALLBACK_NODE_IDS_UPSCALE);
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
            } else {
                console.warn(`[ModelGenPoller][${job.id}] Upscale job ${poseJob.upscale_prompt_id} finished with no output. Marking as failed.`);
                updatedPoseJobs[index].upscale_status = 'failed';
                updatedPoseJobs[index].error_message = 'Upscale job finished with no output.';
                hasChanged = true;
            }
        } else {
            console.error(`[ModelGenPoller][${job.id}] Upscale job ${poseJob.upscale_prompt_id} not found in queue or history. Marking as failed.`);
            updatedPoseJobs[index].upscale_status = 'failed';
            updatedPoseJobs[index].error_message = 'Job not found in ComfyUI history.';
            hasChanged = true;
        }
    }

    return { hasChanged, updatedPoseJobs };
}

async function handleUpscalingPosesState(supabase: any, job: any) {
    console.log(`[ModelGenPoller][${job.id}] State: UPSCALING_POSES.`);
    
    const { hasChanged: pollHasChanged, updatedPoseJobs: polledPoseData } = await pollUpscalingPoses(supabase, job);
    let currentPoseData = polledPoseData;
    let hasChanged = pollHasChanged;

    const posesToProcess = currentPoseData.filter((p: any) => p.upscale_status === 'pending');

    if (posesToProcess.length > 0) {
        console.log(`[ModelGenPoller][${job.id}] Found ${posesToProcess.length} poses pending upscale. Dispatching all.`);

        currentPoseData = currentPoseData.map((p: any) => {
            if (posesToProcess.some((ptp: any) => ptp.final_url === p.final_url)) {
                return { ...p, upscale_status: 'processing' };
            }
            return p;
        });
        hasChanged = true;

        const comfyUiAddress = COMFYUI_ENDPOINT_URL!.replace(/\/+$/, "");
        const upscalePromises = posesToProcess.map(async (poseToProcess: any) => {
            try {
                const imageResponse = await fetch(poseToProcess.final_url);
                if (!imageResponse.ok) throw new Error(`Failed to download image for upscaling: ${imageResponse.statusText}`);
                const imageBlob = await imageResponse.blob();

                const urlParts = poseToProcess.final_url.split('/');
                const originalFilename = urlParts[urlParts.length - 1] || `pose-${Math.random()}.png`;
                const uniqueFilename = `upscale_input_${job.id}_${originalFilename}`;
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
                console.error(`[ModelGenPoller][${job.id}] ERROR: Failed to start upscale for pose ${poseToProcess.pose_prompt}:`, error.message);
                return { final_url: poseToProcess.final_url, error_message: error.message, success: false };
            }
        });

        const results = await Promise.allSettled(upscalePromises);

        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                const poseIndex = currentPoseData.findIndex((p: any) => p.final_url === result.value.final_url);
                if (poseIndex !== -1) {
                    if (result.value.success) {
                        currentPoseData[poseIndex].upscale_prompt_id = result.value.upscale_prompt_id;
                    } else {
                        currentPoseData[poseIndex].upscale_status = 'failed';
                        currentPoseData[poseIndex].error_message = result.value.error_message;
                    }
                }
            }
        });
    }

    const isStillWorking = currentPoseData.some((p: any) => p.upscale_status === 'processing' || p.upscale_status === 'pending');
    
    let finalStatus = job.status;
    if (!isStillWorking) {
        finalStatus = 'complete';
        console.log(`[ModelGenPoller][${job.id}] All upscaling jobs are complete or failed. Setting main job status to complete.`);
    }

    if (hasChanged || finalStatus !== job.status) {
        await supabase.from('mira-agent-model-generation-jobs').update({ 
            final_posed_images: currentPoseData,
            status: finalStatus 
        }).eq('id', job.id);
    }
    
    if (isStillWorking) {
        console.log(`[ModelGenPoller][${job.id}] Still waiting for upscaling jobs to complete. Polling will continue on next watchdog cycle.`);
    }
}