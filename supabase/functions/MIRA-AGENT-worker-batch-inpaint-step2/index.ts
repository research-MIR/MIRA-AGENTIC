import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(buffer);
};

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathStartIndex = url.pathname.indexOf(UPLOAD_BUCKET);
    if (pathStartIndex === -1) {
        throw new Error(`Could not find bucket name '${UPLOAD_BUCKET}' in URL path: ${publicUrl}`);
    }
    const filePath = decodeURIComponent(url.pathname.substring(pathStartIndex + UPLOAD_BUCKET.length + 1));
    const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage: ${error.message}`);
    return data;
}

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

    const { user_id, source_person_image_url, source_garment_image_url, prompt_appendix } = pairJob;

    const [personBlob, garmentBlob] = await Promise.all([
        downloadFromSupabase(supabase, source_person_image_url),
        downloadFromSupabase(supabase, source_garment_image_url)
    ]);
    
    const [personBase64, garmentBase64] = await Promise.all([
        blobToBase64(personBlob),
        blobToBase64(garmentBlob)
    ]);

    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
        body: {
            person_image_base64: personBase64,
            person_image_mime_type: personBlob.type,
            garment_image_base64: garmentBase64,
            garment_image_mime_type: garmentBlob.type,
            prompt_appendix: prompt_appendix,
            is_garment_mode: true,
        }
    });
    if (promptError) throw new Error(`Prompt generation failed: ${promptError.message}`);
    const finalPrompt = promptData.final_prompt;

    const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
        body: {
            mode: 'inpaint',
            user_id: user_id,
            full_source_image_base64: personBase64,
            mask_image_url: final_mask_url,
            prompt: finalPrompt,
            reference_image_base64: garmentBase64,
            denoise: 0.99,
            resolution: 'standard',
            mask_expansion_percent: 3,
            num_attempts: 1,
            batch_pair_job_id: pair_job_id
        }
    });
    if (proxyError) throw new Error(`Job queuing failed: ${proxyError.message}`);
    
    const inpaintingJobId = proxyData.jobIds[0];
    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
        .update({ status: 'delegated', inpainting_job_id: inpaintingJobId })
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