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
const FINAL_OUTPUT_NODE_ID = "431"; // CORRECTED: This is the SaveImage node
const FALLBACK_NODE_IDS = ["445", "430", "9", "4"]; // Other potential output nodes

async function findOutputImage(historyOutputs: any): Promise<any | null> {
    if (!historyOutputs) return null;
    
    const nodesToCheck = [FINAL_OUTPUT_NODE_ID, ...FALLBACK_NODE_IDS];

    for (const nodeId of nodesToCheck) {
        const nodeOutput = historyOutputs[nodeId];
        if (nodeOutput?.images && Array.isArray(nodeOutput.images) && nodeOutput.images.length > 0) {
            console.log(`[Poller] Found output image in designated node ${nodeId}.`);
            return nodeOutput.images[0];
        }
    }

    console.warn(`[Poller] Could not find output in any designated nodes (${nodesToCheck.join(', ')}). Searching all nodes as a final fallback.`);
    for (const nodeId in historyOutputs) {
        const outputData = historyOutputs[nodeId];
        if (outputData.images && Array.isArray(outputData.images) && outputData.images.length > 0) {
            console.log(`[Poller] Found fallback output image in unexpected node ${nodeId}.`);
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
    }
}

async function wakeUpMainAgent(supabase: any, comfyJob: any, finalResult: any) {
    if (!comfyJob.main_agent_job_id) return;
    
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

    await supabase
        .from('mira-agent-jobs')
        .update({
            status: 'processing',
            final_result: null,
            context: { ...mainJob.context, history: newHistory }
        })
        .eq('id', comfyJob.main_agent_job_id);

    supabase.functions.invoke('MIRA-AGENT-master-worker', {
        body: { job_id: comfyJob.main_agent_job_id }
    }).catch((err: any) => {
        console.error(`[Poller][${comfyJob.id}] Failed to invoke master-worker after waking up job:`, err);
    });
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
        console.log(`[Poller][${job_id}] Job is still running or pending in the ComfyUI queue. Re-polling.`);
        await supabase.from('mira-agent-comfyui-jobs').update({ status: 'processing' }).eq('id', job_id);
        setTimeout(() => { supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id } }).catch(console.error); }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'processing' }), { headers: corsHeaders });
    }

    const historyUrl = `${job.comfyui_address}/history/${job.comfyui_prompt_id}`;
    const historyResponse = await fetch(historyUrl);
    if (!historyResponse.ok) {
        console.error(`[Poller][${job_id}] Job not found in queue or history. Marking as failed.`);
        throw new Error("Job disappeared from the queue without completing successfully. It may have been cancelled or failed on the ComfyUI server.");
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
        console.error(`[Poller][${job.id}] Job not in queue, but history exists without a valid output image. Marking as failed.`);
        throw new Error("Job finished with an incomplete or invalid output in its history.");
    }

  } catch (error) {
    console.error(`[Poller][${job_id}] Unhandled error:`, error);
    await supabase.from('mira-agent-comfyui-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});