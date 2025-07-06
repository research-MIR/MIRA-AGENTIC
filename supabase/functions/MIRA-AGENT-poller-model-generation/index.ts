import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const finalResults = [];
    for (const [index, pose] of job.pose_prompts.entries()) {
        console.log(`[ModelGenPoller][${job.id}] Processing pose ${index + 1}/${job.pose_prompts.length}: type=${pose.type}`);
        const payload = {
            base_model_url: job.base_model_image_url,
            pose_prompt: pose.type === 'text' ? pose.value : null,
            pose_image_url: pose.type === 'image' ? pose.value : null,
        };
        const { data: result, error: mockError } = await supabase.functions.invoke('MIRA-AGENT-mock-comfyui-pose-generator', { body: payload });
        if (mockError) throw new Error(`Mock generator failed for pose ${index + 1}: ${mockError.message}`);
        finalResults.push({
            pose_prompt: pose.value,
            pose_type: pose.type,
            generated_url: result.output_image_url
        });
    }
    await supabase.from('mira-agent-model-generation-jobs').update({ status: 'complete', final_posed_images: finalResults }).eq('id', job.id);
    console.log(`[ModelGenPoller][${job.id}] All poses processed. Job complete.`);
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