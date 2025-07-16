import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const POLLING_INTERVAL_MS = 5000;
const FINAL_OUTPUT_NODE_ID = "283"; // CORRECTED for tiled upscaler
const FALLBACK_NODE_IDS = ["9", "4"]; // Generic fallbacks
const MAX_RETRIES = 2;

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
  console.log(`[Poller][${job_id}] Invoked to check status.`);

  try {
    await supabase.from('mira-agent-comfyui-jobs').update({ last_polled_at: new Date().toISOString() }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase.from('mira-agent-comfyui-jobs').select('*').eq('id', job_id).single();
    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    if (job.status === 'complete' || job.status === 'failed') {
        return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const queueUrl = `${job.comfyui_address}/queue`;
    const queueResponse = await fetch(queueUrl);
    if (!queueResponse.ok) throw new Error(`Failed to fetch ComfyUI queue status: ${queueResponse.statusText}`);
    const queueData = await queueResponse.json();
    
    const isJobInQueue = queueData.queue_running.some((item: any) => item[1] === job.comfyui_prompt_id) || 
                         queueData.queue_pending.some((item: any) => item[1] === job.comfyui_prompt_id);

    if (isJobInQueue) {
        console.log(`[Poller][${job_id}] Job is still running or pending. Re-polling.`);
        await supabase.from('mira-agent-comfyui-jobs').update({ status: 'processing' }).eq('id', job_id);
        setTimeout(() => { supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id } }).catch(console.error); }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'processing' }), { headers: corsHeaders });
    }

    const historyUrl = `${job.comfyui_address}/history/${job.comfyui_prompt_id}`;
    const historyResponse = await fetch(historyUrl);
    if (!historyResponse.ok) {
        throw new Error("Job not found in queue or history. Marking as failed.");
    }
    
    const historyData = await historyResponse.json();
    const promptHistory = historyData[job.comfyui_prompt_id];
    const outputImage = await findOutputImage(promptHistory?.outputs);

    if (outputImage) {
        console.log(`[Poller][${job.id}] Image found in history! Filename: ${outputImage.filename}. Processing result.`);
        const imageUrl = `${job.comfyui_address}/view?filename=${encodeURIComponent(outputImage.filename)}&subfolder=${encodeURIComponent(outputImage.subfolder)}&type=${outputImage.type}`;
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error("Failed to download final image from ComfyUI.");
        const imageBuffer = await imageResponse.arrayBuffer();
        
        const filePath = `${job.user_id}/${Date.now()}_comfyui_${outputImage.filename}`;
        await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
        const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
        
        const finalResult = { publicUrl, storagePath: filePath };
        await supabase.from('mira-agent-comfyui-jobs').update({ status: 'complete', final_result: finalResult }).eq('id', job_id);
        
        if (job.main_agent_job_id) {
            await wakeUpMainAgent(supabase, job, finalResult);
        } else {
            await createGalleryEntry(supabase, job, finalResult);
        }
        console.log(`[Poller][${job.id}] All steps complete. Polling finished.`);
        return new Response(JSON.stringify({ success: true, status: 'complete', publicUrl }), { headers: corsHeaders });
    } else {
        console.warn(`[Poller][${job.id}] Job finished with no output. Attempting retry #${(job.retry_count || 0) + 1}...`);
        if ((job.retry_count || 0) < MAX_RETRIES) {
            const originalWorkflow = job.metadata?.workflow_payload;
            if (!originalWorkflow) {
                throw new Error("Cannot retry job: original workflow payload is missing from metadata.");
            }
            
            const queueUrl = `${job.comfyui_address}/prompt`;
            const response = await fetch(queueUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
                body: JSON.stringify(originalWorkflow)
            });
            if (!response.ok) throw new Error(`ComfyUI retry request failed: ${await response.text()}`);
            const data = await response.json();
            if (!data.prompt_id) throw new Error("ComfyUI did not return a new prompt_id on retry.");

            await supabase.from('mira-agent-comfyui-jobs').update({
                comfyui_prompt_id: data.prompt_id,
                status: 'queued',
                retry_count: (job.retry_count || 0) + 1
            }).eq('id', job.id);

            console.log(`[Poller][${job.id}] Job re-queued with new prompt_id: ${data.prompt_id}. Re-invoking poller.`);
            setTimeout(() => { supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id } }).catch(console.error); }, POLLING_INTERVAL_MS);
            return new Response(JSON.stringify({ success: true, status: 'retrying' }), { headers: corsHeaders });
        } else {
            throw new Error(`Job failed after ${MAX_RETRIES} retries.`);
        }
    }

  } catch (error) {
    console.error(`[Poller][${job_id}] Unhandled error:`, error);
    await supabase.from('mira-agent-comfyui-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});