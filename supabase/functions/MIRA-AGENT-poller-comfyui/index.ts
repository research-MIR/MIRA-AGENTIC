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
const POLLING_INTERVAL_MS = 3000; // 3 seconds
const MAX_POLLING_ATTEMPTS = 100; // 5 minutes total

async function findOutputImage(historyOutputs: any): Promise<any | null> {
    if (!historyOutputs) return null;

    // Iterate through all nodes in the output history
    for (const nodeId in historyOutputs) {
        const outputData = historyOutputs[nodeId];
        // Check if the node has an 'images' array with content
        if (outputData.images && Array.isArray(outputData.images) && outputData.images.length > 0) {
            // Return the first image found. This is sufficient for our current workflows.
            console.log(`[Poller] Found output image in node ${nodeId}.`);
            return outputData.images[0];
        }
    }

    // Return null if no node with images was found
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

async function wakeUpMainAgent(supabase: any, comfyJob: any, finalResult: any) {
    if (!comfyJob.main_agent_job_id) return;
    
    console.log(`[Poller][${comfyJob.id}] This job is linked to main agent job ${comfyJob.main_agent_job_id}. Waking it up...`);

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

    const { error: updateError } = await supabase
        .from('mira-agent-jobs')
        .update({
            status: 'processing',
            context: { ...mainJob.context, history: newHistory }
        })
        .eq('id', comfyJob.main_agent_job_id);

    if (updateError) {
        console.error(`[Poller][${comfyJob.id}] Failed to update main agent job:`, updateError);
        return;
    }

    console.log(`[Poller][${comfyJob.id}] Main agent job updated. Re-invoking master-worker...`);
    supabase.functions.invoke('MIRA-AGENT-master-worker', { body: { job_id: comfyJob.main_agent_job_id } }).catch(console.error);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id, attempt = 1 } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[Poller][${job_id}] Invoked. Attempt #${attempt}`);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    console.log(`[Poller][${job_id}] Fetched job from DB. Status: ${job.status}`);

    if (job.status === 'complete' || job.status === 'failed') {
        console.log(`[Poller][${job_id}] Job already resolved. Stopping poll.`);
        return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const historyUrl = `${job.comfyui_address}/history/${job.comfyui_prompt_id}`;
    console.log(`[Poller][${job_id}] Fetching history from: ${historyUrl}`);
    const historyResponse = await fetch(historyUrl);
    if (!historyResponse.ok) throw new Error(`Failed to fetch history from ComfyUI: ${historyResponse.statusText}`);
    
    const historyData = await historyResponse.json();
    const promptHistory = historyData[job.comfyui_prompt_id];

    if (!promptHistory) {
        if (attempt > MAX_POLLING_ATTEMPTS) throw new Error("Polling timed out waiting for job to appear in history.");
        
        console.log(`[Poller][${job_id}] Job not yet in history. Re-scheduling poll.`);
        await supabase.from('mira-agent-comfyui-jobs').update({ status: 'queued' }).eq('id', job_id);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id, attempt: attempt + 1 } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'queued' }), { headers: corsHeaders });
    }
    console.log(`[Poller][${job_id}] History found. Searching for output image...`);

    const outputImage = await findOutputImage(promptHistory.outputs);

    if (outputImage) {
        console.log(`[Poller][${job_id}] Image found! Filename: ${outputImage.filename}`);
        const imageUrl = `${job.comfyui_address}/view?filename=${encodeURIComponent(outputImage.filename)}&subfolder=${encodeURIComponent(outputImage.subfolder)}&type=${outputImage.type}`;
        console.log(`[Poller][${job_id}] Downloading image from: ${imageUrl}`);
        
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error("Failed to download final image from ComfyUI.");
        const imageBuffer = await imageResponse.arrayBuffer();
        console.log(`[Poller][${job_id}] Image downloaded successfully.`);

        const filePath = `${job.user_id}/${Date.now()}_comfyui_${outputImage.filename}`;
        console.log(`[Poller][${job_id}] Uploading to Supabase Storage at: ${filePath}`);
        await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
        const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
        console.log(`[Poller][${job_id}] Upload complete. Public URL: ${publicUrl}`);

        const finalResult = { publicUrl, storagePath: filePath };
        await supabase.from('mira-agent-comfyui-jobs').update({
            status: 'complete',
            final_result: finalResult
        }).eq('id', job_id);
        console.log(`[Poller][${job_id}] Job status updated to 'complete' in DB.`);

        if (job.main_agent_job_id) {
            await wakeUpMainAgent(supabase, job, finalResult);
        } else {
            await createGalleryEntry(supabase, job, finalResult);
        }

        return new Response(JSON.stringify({ success: true, status: 'complete', publicUrl }), { headers: corsHeaders });
    } else {
        if (attempt > MAX_POLLING_ATTEMPTS) throw new Error("Polling timed out waiting for image output.");

        console.log(`[Poller][${job_id}] Job running, but a final output node (SaveImage/PreviewImage) was not found in the history outputs.`);
        console.log(`[Poller][${job_id}] For debugging, here are the current outputs from all nodes:`, JSON.stringify(promptHistory.outputs, null, 2));
        
        await supabase.from('mira-agent-comfyui-jobs').update({ status: 'processing' }).eq('id', job_id);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id, attempt: attempt + 1 } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'processing' }), { headers: corsHeaders });
    }

  } catch (error) {
    console.error(`[Poller][${job_id}] Unhandled error:`, error);
    await supabase.from('mira-agent-comfyui-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});