import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  const { job_id } = await req.json();
  if (!job_id) return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-vto-pipeline-jobs')
      .select('*, bitstudio_job:bitstudio_job_id(final_image_url)')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;

    const mode = job.context?.mode || 'edit';

    switch (job.status) {
      case 'pending_segmentation': {
        console.log(`[VTO Worker][${job_id}] Starting segmentation in '${mode}' mode...`);
        
        const segmentationPrompt = mode === 'vton' 
            ? "Create a tight bounding box that encloses only the person in the image, from head to toe."
            : "Segment the main garment on the person.";

        const { data: segResult, error: segError } = await supabase.functions.invoke('MIRA-AGENT-worker-segmentation', {
            body: { 
                person_image_url: job.source_person_image_url,
                garment_image_url: job.source_garment_image_url,
                user_prompt: segmentationPrompt
            }
        });
        if(segError) throw segError;

        await supabase.from('mira-agent-vto-pipeline-jobs').update({
            status: 'pending_crop',
            segmentation_result: segResult.result
        }).eq('id', job_id);
        
        supabase.functions.invoke('MIRA-AGENT-worker-vto-pipeline', { body: { job_id } });
        break;
      }
      case 'pending_crop': {
        console.log(`[VTO Worker][${job_id}] Cropping image...`);
        const segmentationResult = job.segmentation_result;
        if (!segmentationResult || !segmentationResult.masks || segmentationResult.masks.length === 0) {
            throw new Error("Segmentation result with a valid mask is required for cropping.");
        }
        const box = segmentationResult.masks[0].box_2d;

        const { data: cropResult, error: cropError } = await supabase.functions.invoke('MIRA-AGENT-tool-crop-image', {
            body: {
                image_url: job.source_person_image_url,
                box: box,
                user_id: job.user_id
            }
        });
        if (cropError) throw cropError;

        await supabase.from('mira-agent-vto-pipeline-jobs').update({
            status: 'pending_prompt_generation',
            cropped_image_url: cropResult.cropped_image_url
        }).eq('id', job_id);
        
        supabase.functions.invoke('MIRA-AGENT-worker-vto-pipeline', { body: { job_id } });
        break;
      }
      case 'pending_prompt_generation': {
        console.log(`[VTO Worker][${job_id}] Starting prompt generation in '${mode}' mode...`);
        if (!job.cropped_image_url) throw new Error("Cropped image URL is missing for prompt generation step.");

        const { data: profile } = await supabase.from('profiles').select('vto_captioning_preferences').eq('id', job.user_id).single();
        const captioningPref = profile?.vto_captioning_preferences?.[mode] || 'general_detailed';
        
        console.log(`[VTO Worker][${job_id}] User preference for captioning in '${mode}' mode is '${captioningPref}'.`);

        let generatedPrompt = "";

        if (captioningPref === 'none') {
            generatedPrompt = job.context?.optional_details || "A model wearing a new outfit.";
        } else {
            const promptWorkerName = mode === 'vton' ? 'MIRA-AGENT-worker-vto-advanced-prompt-generator' : 'MIRA-AGENT-worker-vto-prompt-generator';
            const { data: promptResult, error: promptError } = await supabase.functions.invoke(promptWorkerName, {
                body: {
                    person_image_url: job.cropped_image_url,
                    garment_image_url: job.source_garment_image_url,
                    optional_details: job.context?.optional_details,
                    captioning_mode: captioningPref
                }
            });
            if (promptError) throw promptError;
            if (!promptResult.result?.prompt) throw new Error("Prompt generation worker did not return a valid prompt.");
            generatedPrompt = promptResult.result.prompt;
        }

        const newSegmentationResult = { ...job.segmentation_result, generated_prompt: generatedPrompt };

        await supabase.from('mira-agent-vto-pipeline-jobs').update({
            status: 'pending_tryon',
            segmentation_result: newSegmentationResult
        }).eq('id', job_id);

        supabase.functions.invoke('MIRA-AGENT-worker-vto-pipeline', { body: { job_id } });
        break;
      }
      case 'pending_tryon': {
        console.log(`[VTO Worker][${job_id}] Starting virtual try-on...`);
        if (!job.cropped_image_url) throw new Error("Cropped image URL is missing for try-on step.");

        const prompt = job.segmentation_result?.generated_prompt;

        const { data: bitstudioJob, error: bitstudioError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio-vto', {
            body: {
                person_image_url: job.cropped_image_url,
                garment_image_url: job.source_garment_image_url,
                user_id: job.user_id,
                prompt: prompt
            }
        });
        if (bitstudioError) throw bitstudioError;

        await supabase.from('mira-agent-vto-pipeline-jobs').update({
            bitstudio_job_id: bitstudioJob.jobId
        }).eq('id', job_id);
        
        console.log(`[VTO Worker][${job_id}] Paused. Waiting for bitStudio job ${bitstudioJob.jobId} to complete.`);
        break;
      }
      case 'pending_composite': {
        console.log(`[VTO Worker][${job_id}] Starting final composite...`);
        const bitstudioResultUrl = (job.bitstudio_job as any)?.final_image_url;
        if (!bitstudioResultUrl) throw new Error("BitStudio try-on result URL is missing.");
        if (!job.segmentation_result?.masks?.[0]?.box_2d) throw new Error("Segmentation box is missing for composite step.");

        const { data: compositeResult, error: compositeError } = await supabase.functions.invoke('MIRA-AGENT-tool-composite-image', {
            body: {
                base_image_url: job.source_person_image_url,
                overlay_image_url: bitstudioResultUrl,
                box: job.segmentation_result.masks[0].box_2d,
                user_id: job.user_id
            }
        });
        if (compositeError) throw compositeError;

        await supabase.from('mira-agent-vto-pipeline-jobs').update({
            status: 'complete',
            final_composite_url: compositeResult.final_composite_url
        }).eq('id', job_id);
        
        console.log(`[VTO Worker][${job_id}] Pipeline complete!`);
        break;
      }
      default:
        console.log(`[VTO Worker] Job ${job_id} has unhandled status: ${job.status}`);
    }

    return new Response(JSON.stringify({ success: true, message: `Handled status ${job.status}` }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[VTO Worker][${job_id}] Error:`, error);
    await supabase.from('mira-agent-vto-pipeline-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});