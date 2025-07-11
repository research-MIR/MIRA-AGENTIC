import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log(`[BatchInpaintWorker-Step2] Function invoked.`);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { pair_job_id, final_mask_url } = await req.json();
  console.log(`[BatchInpaintWorker-Step2][${pair_job_id}] Received payload. pair_job_id: ${pair_job_id}, final_mask_url: ${final_mask_url}`);

  if (!pair_job_id || !final_mask_url) {
    console.error(`[BatchInpaintWorker-Step2] Missing required parameters. pair_job_id: ${!!pair_job_id}, final_mask_url: ${!!final_mask_url}`);
    return new Response(JSON.stringify({ error: "pair_job_id and final_mask_url are required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[BatchInpaintWorker-Step2][${pair_job_id}] Starting inpainting process.`);

  try {
    const { data: pairJob, error: fetchError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('*')
      .eq('id', pair_job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch pair job: ${fetchError.message}`);
    if (!pairJob) throw new Error(`Pair job with ID ${pair_job_id} not found.`);

    if (pairJob.inpainting_job_id) {
        console.warn(`[BatchInpaintWorker-Step2][${pair_job_id}] Safety check triggered. Inpainting job already exists (${pairJob.inpainting_job_id}). This is a duplicate invocation. Exiting gracefully.`);
        return new Response(JSON.stringify({ success: true, message: "Duplicate invocation detected, exiting." }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    const { user_id, source_person_image_url, source_garment_image_url, prompt_appendix, metadata } = pairJob;
    const debug_assets = metadata?.debug_assets || null;
    const isHelperEnabled = metadata?.is_helper_enabled !== false; // Default to true

    console.log(`[BatchInpaintWorker-Step2][${pair_job_id}] Delegating prompt creation to helper. Helper enabled: ${isHelperEnabled}`);

    // The prompt helper now handles all logic, including downloading images if needed.
    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
        body: {
            // Pass URLs directly. The helper will decide whether to download them.
            person_image_url: source_person_image_url,
            garment_image_url: source_garment_image_url,
            prompt_appendix: prompt_appendix,
            is_helper_enabled: isHelperEnabled, // Pass the flag
            is_garment_mode: true,
        }
    });

    if (promptError) throw new Error(`Prompt generation failed: ${promptError.message}`);
    const finalPrompt = promptData.final_prompt;

    const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
        body: {
            mode: 'inpaint',
            user_id: user_id,
            source_image_url: source_person_image_url, // Pass URLs directly
            mask_image_url: final_mask_url,
            prompt: finalPrompt,
            reference_image_url: source_garment_image_url,
            denoise: 0.99,
            resolution: 'standard',
            mask_expansion_percent: 3,
            num_attempts: 1,
            batch_pair_job_id: pair_job_id,
            debug_assets: debug_assets
        }
    });
    if (proxyError) throw new Error(`Job queuing failed: ${proxyError.message}`);
    
    const inpaintingJobId = proxyData.jobIds[0];
    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
        .update({ status: 'delegated', inpainting_job_id: inpaintingJobId, metadata: { ...metadata, prompt_used: finalPrompt } })
        .eq('id', pair_job_id);

    console.log(`[BatchInpaintWorker-Step2][${pair_job_id}] Inpainting job queued successfully. Inpainting Job ID: ${inpaintingJobId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[BatchInpaintWorker-Step2][${pair_job_id}] Error:`, error);
    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
      .update({ status: 'failed', error_message: error.message })
      .eq('id', pair_job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});