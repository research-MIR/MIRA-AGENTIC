import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const POLLING_INTERVAL_MS = 3000; // 3 seconds
const MAX_POLLING_ATTEMPTS = 100; // 5 minutes total

async function findOutputImage(history: any): Promise<any | null> {
    for (const nodeId in history) {
        const node = history[nodeId];
        if (node.class_type === "SaveImage" && node.outputs.images) {
            return node.outputs.images[0];
        }
    }
    return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id, attempt = 1 } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[Poller][${job_id}] Starting poll attempt #${attempt}`);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    if (job.status === 'complete' || job.status === 'failed') {
        console.log(`[Poller][${job_id}] Job already completed or failed. Stopping poll.`);
        return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const historyUrl = `${job.comfyui_address}/history/${job.comfyui_prompt_id}`;
    const historyResponse = await fetch(historyUrl);
    if (!historyResponse.ok) throw new Error(`Failed to fetch history from ComfyUI: ${historyResponse.statusText}`);
    
    const historyData = await historyResponse.json();
    const promptHistory = historyData[job.comfyui_prompt_id];

    if (!promptHistory) {
        if (attempt > MAX_POLLING_ATTEMPTS) throw new Error("Polling timed out waiting for job to start.");
        
        console.log(`[Poller][${job_id}] Job not yet in history. Re-scheduling poll.`);
        await supabase.from('mira-agent-comfyui-jobs').update({ status: 'queued' }).eq('id', job_id);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id, attempt: attempt + 1 } }).catch(console.error);
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

        await supabase.from('mira-agent-comfyui-jobs').update({
            status: 'complete',
            final_result: { publicUrl, storagePath: filePath }
        }).eq('id', job_id);

        console.log(`[Poller][${job_id}] Job complete. Image uploaded to ${publicUrl}`);
        return new Response(JSON.stringify({ success: true, status: 'complete', publicUrl }), { headers: corsHeaders });
    } else {
        if (attempt > MAX_POLLING_ATTEMPTS) throw new Error("Polling timed out waiting for image.");

        console.log(`[Poller][${job_id}] Job running, but output not ready. Re-scheduling poll.`);
        await supabase.from('mira-agent-comfyui-jobs').update({ status: 'processing' }).eq('id', job_id);
        setTimeout(() => {
            supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id, attempt: attempt + 1 } }).catch(console.error);
        }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'processing' }), { headers: corsHeaders });
    }

  } catch (error) {
    console.error(`[Poller][${job_id}] Error:`, error);
    await supabase.from('mira-agent-comfyui-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});