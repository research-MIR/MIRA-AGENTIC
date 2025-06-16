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
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;

    switch (job.status) {
      case 'pending_segmentation': {
        console.log(`[VTO Worker][${job_id}] Starting segmentation...`);
        const { data: segResult, error: segError } = await supabase.functions.invoke('MIRA-AGENT-worker-segmentation', {
            body: { 
                person_image_url: job.source_person_image_url,
                garment_image_url: job.source_garment_image_url,
                user_prompt: "Segment the main garment on the person."
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
            status: 'pending_tryon',
            cropped_image_url: cropResult.cropped_image_url
        }).eq('id', job_id);
        
        supabase.functions.invoke('MIRA-AGENT-worker-vto-pipeline', { body: { job_id } });
        break;
      }
      case 'pending_tryon': {
        console.log(`[VTO Worker][${job_id}] Starting virtual try-on...`);
        if (!job.cropped_image_url) throw new Error("Cropped image URL is missing for try-on step.");

        const { data: bitstudioJob, error: bitstudioError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio-vto', {
            body: {
                person_image_url: job.cropped_image_url, // Use the cropped image
                garment_image_url: job.source_garment_image_url,
                user_id: job.user_id
            }
        });
        if (bitstudioError) throw bitstudioError;

        await supabase.from('mira-agent-vto-pipeline-jobs').update({
            bitstudio_job_id: bitstudioJob.jobId
        }).eq('id', job_id);
        
        console.log(`[VTO Worker][${job_id}] Paused. Waiting for bitStudio job ${bitstudioJob.jobId} to complete.`);
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