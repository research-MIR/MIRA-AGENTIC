import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
const POLLING_INTERVAL_MS = 5000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const tiledUpscalerWorkflow = `
{
  "9": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader" },
  "10": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader" },
  "307": { "inputs": { "String": "masterpiece, best quality, highres" }, "class_type": "String" },
  "349": { "inputs": { "clip_l": ["307", 0], "t5xxl": ["307", 0], "guidance": 2.2, "clip": ["9", 0] }, "class_type": "CLIPTextEncodeFlux" },
  "361": { "inputs": { "clip_l": "over exposed,ugly, depth of field ", "t5xxl": "over exposed,ugly, depth of field", "guidance": 2.5, "clip": ["9", 0] }, "class_type": "CLIPTextEncodeFlux" },
  "404": { "inputs": { "image": "placeholder.png" }, "class_type": "LoadImage" },
  "407": { "inputs": { "upscale_by": ["437", 1], "seed": 82060634998716, "steps": 20, "cfg": 1, "sampler_name": "euler", "scheduler": "normal", "denoise": 0.14, "mode_type": "Linear", "tile_width": 1024, "tile_height": 1024, "mask_blur": 64, "tile_padding": 512, "seam_fix_mode": "None", "seam_fix_denoise": 0.4, "seam_fix_width": 0, "seam_fix_mask_blur": 8, "seam_fix_padding": 16, "force_uniform_tiles": true, "tiled_decode": false, "image": ["421", 0], "model": ["418", 0], "positive": ["349", 0], "negative": ["361", 0], "vae": ["10", 0], "upscale_model": ["408", 0], "custom_sampler": ["423", 0], "custom_sigmas": ["424", 0] }, "class_type": "UltimateSDUpscaleCustomSample" },
  "408": { "inputs": { "model_name": "4xNomosWebPhoto_esrgan.safetensors" }, "class_type": "UpscaleModelLoader" },
  "410": { "inputs": { "value": 1.5 }, "class_type": "FloatConstant" },
  "412": { "inputs": { "double_layers": "10", "single_layers": "3,4", "scale": 3, "start_percent": 0.01, "end_percent": 0.15, "rescaling_scale": 0, "model": ["413", 0] }, "class_type": "SkipLayerGuidanceDiT" },
  "413": { "inputs": { "unet_name": "flux1-dev.safetensors", "weight_dtype": "fp8_e4m3fn_fast" }, "class_type": "UNETLoader" },
  "414": { "inputs": { "lora_name": "Samsung_UltraReal.safetensors", "strength_model": 0.6, "model": ["416", 0] }, "class_type": "LoraLoaderModelOnly" },
  "415": { "inputs": { "lora_name": "IDunnohowtonameLora.safetensors", "strength_model": 0.5, "model": ["414", 0] }, "class_type": "LoraLoaderModelOnly" },
  "416": { "inputs": { "lora_name": "42lux-UltimateAtHome-flux-highresfix.safetensors", "strength_model": 0.98, "model": ["412", 0] }, "class_type": "LoraLoaderModelOnly" },
  "417": { "inputs": { "model": ["415", 0] }, "class_type": "ConfigureModifiedFlux" },
  "418": { "inputs": { "scale": 1.75, "rescale": 0, "model": ["417", 0] }, "class_type": "PAGAttention" },
  "420": { "inputs": { "pixels": ["404", 0], "vae": ["10", 0] }, "class_type": "VAEEncode" },
  "421": { "inputs": { "samples": ["420", 0], "vae": ["10", 0] }, "class_type": "VAEDecode" },
  "422": { "inputs": { "sampler_name": "dpmpp_2m" }, "class_type": "KSamplerSelect" },
  "423": { "inputs": { "dishonesty_factor": -0.01, "start_percent": 0.46, "end_percent": 0.95, "sampler": ["422", 0] }, "class_type": "LyingSigmaSampler" },
  "424": { "inputs": { "scheduler": "sgm_uniform", "steps": 10, "denoise": 0.14, "model": ["418", 0] }, "class_type": "BasicScheduler" },
  "431": { "inputs": { "filename_prefix": "UpscaledPose", "images": ["445", 0] }, "class_type": "SaveImage" },
  "432": { "inputs": { "upscale_by": ["437", 1], "seed": 839614371047984, "steps": 20, "cfg": 1, "sampler_name": "euler", "scheduler": "normal", "denoise": 0.17, "mode_type": "Linear", "tile_width": 1024, "tile_height": 1024, "mask_blur": 64, "tile_padding": 512, "seam_fix_mode": "None", "seam_fix_denoise": 0.4, "seam_fix_width": 64, "seam_fix_mask_blur": 8, "seam_fix_padding": 16, "force_uniform_tiles": true, "tiled_decode": false, "image": ["407", 0], "model": ["418", 0], "positive": ["349", 0], "negative": ["361", 0], "vae": ["10", 0], "upscale_model": ["408", 0], "custom_sampler": ["423", 0], "custom_sigmas": ["444", 0] }, "class_type": "UltimateSDUpscaleCustomSample" },
  "437": { "inputs": { "expression": "a**0.5", "a": ["410", 0] }, "class_type": "MathExpression|pysssss" },
  "444": { "inputs": { "scheduler": "sgm_uniform", "steps": 10, "denoise": 0.25, "model": ["418", 0] }, "class_type": "BasicScheduler" },
  "445": { "inputs": { "method": "hm-mvgd-hm", "strength": 1.0, "image_ref": ["404", 0], "image_target": ["432", 0] }, "class_type": "ColorMatch" }
}
`;

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
    const updatedPoseJobs = [...job.final_posed_images];
    const comfyUiAddress = COMFYUI_ENDPOINT_URL!.replace(/\/+$/, "");

    for (const [index, poseJob] of updatedPoseJobs.entries()) {
        if (poseJob.status === 'complete') continue;

        allComplete = false;

        const historyUrl = `${comfyUiAddress}/history/${poseJob.comfyui_prompt_id}`;
        const historyResponse = await fetch(historyUrl);
        
        if (historyResponse.ok) {
            const historyData = await historyResponse.json();
            const promptHistory = historyData[poseJob.comfyui_prompt_id];
            const outputNode = promptHistory?.outputs['213'] || promptHistory?.outputs['9'];
            if (outputNode?.images && outputNode.images.length > 0) {
                const image = outputNode.images[0];
                const imageUrl = `${comfyUiAddress}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${image.type}`;
                updatedPoseJobs[index].status = 'complete';
                updatedPoseJobs[index].final_url = imageUrl;
                updatedPoseJobs[index].is_upscaled = false;
                console.log(`[ModelGenPoller][${job.id}] Pose job ${poseJob.comfyui_prompt_id} is complete. URL: ${imageUrl}`);
            }
        }
    }

    if (allComplete) {
        console.log(`[ModelGenPoller][${job.id}] All pose jobs are complete. Finalizing main job.`);
        await supabase.from('mira-agent-model-generation-jobs').update({ 
            status: 'complete', 
            final_posed_images: updatedPoseJobs 
        }).eq('id', job.id);
    } else {
        console.log(`[ModelGenPoller][${job.id}] Not all pose jobs are complete. Updating progress and re-polling.`);
        await supabase.from('mira-agent-model-generation-jobs').update({ 
            final_posed_images: updatedPoseJobs 
        }).eq('id', job.id);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
    }
}

async function handleUpscalingPosesState(supabase: any, job: any) {
    console.log(`[ModelGenPoller][${job.id}] State: UPSCALING_POSES.`);
    const updatedPoseJobs = [...job.final_posed_images];
    const comfyUiAddress = COMFYUI_ENDPOINT_URL!.replace(/\/+$/, "");
    
    const poseToProcessIndex = updatedPoseJobs.findIndex(p => p.upscale_status === 'pending');

    if (poseToProcessIndex === -1) {
        const isStillProcessing = updatedPoseJobs.some(p => p.upscale_status === 'processing');
        if (!isStillProcessing) {
            console.log(`[ModelGenPoller][${job.id}] No more poses to upscale. Setting status to complete.`);
            await supabase.from('mira-agent-model-generation-jobs').update({ status: 'complete' }).eq('id', job.id);
        } else {
            console.log(`[ModelGenPoller][${job.id}] Waiting for processing poses to complete. Re-polling.`);
            setTimeout(() => {
                supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
            }, POLLING_INTERVAL_MS);
        }
        return;
    }

    const poseToProcess = updatedPoseJobs[poseToProcessIndex];

    try {
        console.log(`[ModelGenPoller][${job.id}] Upscaling pose: ${poseToProcess.pose_prompt}`);
        updatedPoseJobs[poseToProcessIndex].upscale_status = 'processing';
        await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoseJobs }).eq('id', job.id);

        const imageResponse = await fetch(poseToProcess.final_url);
        if (!imageResponse.ok) throw new Error(`Failed to download image for upscaling: ${imageResponse.statusText}`);
        const imageBlob = await imageResponse.blob();

        const formData = new FormData();
        formData.append('image', imageBlob, 'image_to_upscale.png');
        formData.append('overwrite', 'true');
        const uploadResponse = await fetch(`${comfyUiAddress}/upload/image`, { method: 'POST', body: formData });
        if (!uploadResponse.ok) throw new Error(`ComfyUI upload failed: ${await uploadResponse.text()}`);
        const uploadData = await uploadResponse.json();
        const uploadedFilename = uploadData.name;

        const workflow = JSON.parse(tiledUpscalerWorkflow);
        workflow['404'].inputs.image = uploadedFilename;
        workflow['410'].inputs.value = 1.5; // Default upscale factor
        workflow['407'].inputs.seed = Math.floor(Math.random() * 1e15);
        workflow['432'].inputs.seed = Math.floor(Math.random() * 1e15);

        const queueResponse = await fetch(`${comfyUiAddress}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: workflow })
        });
        if (!queueResponse.ok) throw new Error(`ComfyUI queue request failed: ${await queueResponse.text()}`);
        const queueData = await queueResponse.json();
        
        updatedPoseJobs[poseToProcessIndex].upscale_prompt_id = queueData.prompt_id;
        await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoseJobs }).eq('id', job.id);

        // Re-invoke immediately to check for the next one
        supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);

    } catch (error) {
        console.error(`[ModelGenPoller][${job.id}] Failed to start upscale for pose ${poseToProcess.pose_prompt}:`, error.message);
        updatedPoseJobs[poseToProcessIndex].upscale_status = 'failed';
        updatedPoseJobs[poseToProcessIndex].error_message = error.message;
        await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoseJobs }).eq('id', job.id);
        // Re-invoke to try the next one if any
        supabase.functions.invoke('MIRA-AGENT-poller-model-generation', { body: { job_id: job.id } }).catch(console.error);
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
            const outputNode = promptHistory?.outputs['431']; // Save Image node
            if (outputNode?.images && outputNode.images.length > 0) {
                const image = outputNode.images[0];
                const imageUrl = `${comfyUiAddress}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${image.type}`;
                
                updatedPoseJobs[index].final_url = imageUrl;
                updatedPoseJobs[index].is_upscaled = true;
                updatedPoseJobs[index].upscale_status = 'complete';
                hasChanged = true;
                console.log(`[ModelGenPoller][${job.id}] Pose successfully upscaled. New URL: ${imageUrl}`);
            }
        }
    }

    if (hasChanged) {
        await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoseJobs }).eq('id', job.id);
    }
}

serve(async (req) => {
  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");

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
            await pollUpscalingPoses(supabase, job); // Poll existing processing jobs first
            await handleUpscalingPosesState(supabase, job); // Then try to start a new one
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
    console.error(`[ModelGenPoller][${job_id}] Error:`, error);
    await supabase.from('mira-agent-model-generation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});