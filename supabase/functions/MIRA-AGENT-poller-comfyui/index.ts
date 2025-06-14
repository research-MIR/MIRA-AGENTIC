import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const POLLING_INTERVAL_MS = 5000; // 5 seconds for rapid polling

async function findOutputImage(historyOutputs: any): Promise<any | null> {
    if (!historyOutputs) return null;
    for (const nodeId in historyOutputs) {
        const outputData = historyOutputs[nodeId];
        if (outputData.images && Array.isArray(outputData.images) && outputData.images.length > 0) {
            console.log(`[Poller] Found output image in node ${nodeId}.`);
            return outputData.images[0];
        }
    }
    return null;
}

async function createGalleryEntry(supabase: any, job: any, finalResult: any) {
    if (!job.metadata?.invoker_user_id || !job.metadata?.original_prompt_for_gallery) {
        console.log(`[Poller][${job.id}] Skipping gallery entry creation: missing metadata.`);
        return;
    }
    const jobPayload = {
        user_id: job.metadata.invoker_user_id,
        original_prompt: job.metadata.original_prompt_for_gallery,
        status: 'complete',
        final_result: { isImageGeneration: true, images: [finalResult] },
        context: { source: 'refiner' }
    };
    const { error: insertError } = await supabase.from('mira-agent-jobs').insert(jobPayload);
    if (insertError) {
        console.error(`[Poller][${job.id}] Failed to create gallery entry:`, insertError);
    } else {
        console.log(`[Poller][${job.id}] Successfully created gallery entry.`);
    }
}

async function wakeUpMainAgent(supabase: SupabaseClient, comfyJob: any, finalResult: any) {
    if (!comfyJob.main_agent_job_id) return;
    
    console.log(`[Poller][${comfyJob.id}] This job is linked to main agent job ${comfyJob.main_agent_job_id}. Waking it up.`);
    const { data: mainJob, error: fetchError } = await supabase
        .from('mira-agent-jobs')
        .select('context')
        .eq('id', comfyJob.main_agent_job_id)
        .single();

    if (fetchError) {
        console.error(`[Poller][${comfyJob.id}] Could not fetch parent agent job:`, fetchError);
        return;
    }

    const newHistory = [
        ...(mainJob.context?.history || []),
        {
            role: 'function',
            parts: [{
                functionResponse: {
                    name: 'dispatch_to_refinement_agent',
                    response: {
                        isImageGeneration: true,
                        images: [finalResult]
                    }
                }
            }]
        }
    ];

    // Update the main job's history and set it back to 'processing'
    const { error: updateError } = await supabase
        .from('mira-agent-jobs')
        .update({
            status: 'processing', // Set back to processing
            context: { ...mainJob.context, history: newHistory },
            final_result: null // Clear any previous final_result
        })
        .eq('id', comfyJob.main_agent_job_id);

    if (updateError) {
        console.error(`[Poller][${comfyJob.id}] Failed to update main agent job:`, updateError);
        return;
    }

    console.log(`[Poller][${comfyJob.id}] Main agent job status set to 'processing'. Re-invoking master-worker.`);
    // Re-invoke the master worker to continue the plan
    supabase.functions.invoke('MIRA-AGENT-master-worker', { body: { job_id: comfyJob.main_agent_job_id } }).catch(console.error);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[Poller][${job_id}] Invoked to check status.`);

  try {
    // Mark the job as being polled right now to prevent watchdog conflicts
    await supabase.from('mira-agent-comfyui-jobs').update({ last_polled_at: new Date().toISOString() }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    
    if (job.status === 'complete' || job.status === 'failed') {
        console.log(`[Poller][${job_id}] Job already resolved. Halting check.`);
        return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const historyUrl = `${job.comfyui_address}/history/${job.comfyui_prompt_id}`;
    const historyResponse = await fetch(historyUrl);
    if (!historyResponse.ok) {
        console.warn(`[Poller][${job_id}] ComfyUI history not available yet. Will retry.`);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'queued' }), { headers: corsHeaders });
    }
    
    const historyData = await historyResponse.json();
    const promptHistory = historyData[job.comfyui_prompt_id];

    if (!promptHistory) {
        console.log(`[Poller][${job_id}] Job not yet in history. Will retry.`);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'queued' }), { headers: corsHeaders });
    }

    const outputImage = await findOutputImage(promptHistory.outputs);

    if (outputImage) {
        console.log(`[Poller][${job_id}] Image found! Filename: ${outputImage.filename}`);
        const imageUrl = `${job.comfyui_address}/view?filename=${encodeURIComponent(outputImage.filename)}&subfolder=${encodeURIComponent(outputImage.subfolder)}&type=${outputImage.type}`;
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error("Failed to download final image from ComfyUI.");
        const imageBuffer = await imageResponse.arrayBuffer();
        
        const filePath = `${job.user_id}/${Date.now()}_comfyui_${outputImage.filename}`;
        await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
        const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
        
        const finalResult = { publicUrl, storagePath: filePath };
        await supabase.from('mira-agent-comfyui-jobs').update({
            status: 'complete',
            final_result: finalResult
        }).eq('id', job_id);
        
        if (job.main_agent_job_id) {
            await wakeUpMainAgent(supabase, job, finalResult);
        } else {
            await createGalleryEntry(supabase, job, finalResult);
        }

        return new Response(JSON.stringify({ success: true, status: 'complete', publicUrl }), { headers: corsHeaders });
    } else {
        console.log(`[Poller][${job_id}] Job is running, but output not ready. Re-polling in ${POLLING_INTERVAL_MS}ms.`);
        await supabase.from('mira-agent-comfyui-jobs').update({ status: 'processing' }).eq('id', job_id);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'processing' }), { headers: corsHeaders });
    }

  } catch (error) {
    console.error(`[Poller][${job_id}] Unhandled error:`, error);
    await supabase.from('mira-agent-comfyui-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});