import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const POLLING_INTERVAL_MS = 5000;
const FINAL_OUTPUT_NODE_ID = "9";

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[InpaintingPoller][${job_id}] Invoked.`);

  try {
    await supabase.from('mira-agent-inpainting-jobs').update({ last_polled_at: new Date().toISOString() }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-inpainting-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    
    if (job.status === 'complete' || job.status === 'failed' || job.status === 'compositing') {
        console.log(`[InpaintingPoller][${job.id}] Job already resolved or being composited. Halting.`);
        return new Response(JSON.stringify({ success: true, message: "Job already resolved or being composited." }), { headers: corsHeaders });
    }

    const historyUrl = `${job.comfyui_address}/history/${job.comfyui_prompt_id}`;
    const historyResponse = await fetch(historyUrl);
    if (!historyResponse.ok) {
        console.log(`[InpaintingPoller][${job.id}] History not available yet. Retrying.`);
        setTimeout(() => { supabase.functions.invoke('MIRA-AGENT-poller-inpainting', { body: { job_id } }).catch(console.error); }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'queued' }), { headers: corsHeaders });
    }
    
    const historyData = await historyResponse.json();
    const promptHistory = historyData[job.comfyui_prompt_id];

    if (!promptHistory) {
        console.log(`[InpaintingPoller][${job.id}] Job not yet in history. Retrying.`);
        setTimeout(() => { supabase.functions.invoke('MIRA-AGENT-poller-inpainting', { body: { job_id } }).catch(console.error); }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'queued' }), { headers: corsHeaders });
    }

    const outputImage = promptHistory.outputs[FINAL_OUTPUT_NODE_ID]?.images?.[0];

    if (outputImage) {
        console.log(`[InpaintingPoller][${job.id}] Image found! Filename: ${outputImage.filename}.`);
        const imageUrl = `${job.comfyui_address}/view?filename=${encodeURIComponent(outputImage.filename)}&subfolder=${encodeURIComponent(outputImage.subfolder)}&type=${outputImage.type}`;
        
        await supabase.from('mira-agent-inpainting-jobs').update({
            status: 'compositing',
            final_result: { publicUrl: imageUrl } // Store the temporary URL of the crop
        }).eq('id', job_id);

        console.log(`[InpaintingPoller][${job.id}] Inpainting complete. Triggering compositor...`);
        supabase.functions.invoke('MIRA-AGENT-compositor-inpainting', { body: { job_id } }).catch(console.error);
        
        return new Response(JSON.stringify({ success: true, status: 'compositing' }), { headers: corsHeaders });
    } else {
        console.log(`[InpaintingPoller][${job.id}] Job running, output not ready. Re-polling.`);
        await supabase.from('mira-agent-inpainting-jobs').update({ status: 'processing' }).eq('id', job_id);
        setTimeout(() => { supabase.functions.invoke('MIRA-AGENT-poller-inpainting', { body: { job_id } }).catch(console.error); }, POLLING_INTERVAL_MS);
        return new Response(JSON.stringify({ success: true, status: 'processing' }), { headers: corsHeaders });
    }

  } catch (error) {
    console.error(`[InpaintingPoller][${job_id}] Error:`, error);
    await supabase.from('mira-agent-inpainting-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});