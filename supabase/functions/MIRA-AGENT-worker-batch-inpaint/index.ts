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

    if (!filePath) {
        throw new Error(`Could not parse file path from URL: ${publicUrl}`);
    }

    const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath);

    if (error) {
        throw new Error(`Failed to download from Supabase storage: ${error.message}`);
    }
    return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { pair_job_id } = await req.json();
  if (!pair_job_id) {
    return new Response(JSON.stringify({ error: "pair_job_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[BatchInpaintWorker][${pair_job_id}] Starting processing.`);

  try {
    const { data: pairJob, error: fetchError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('*')
      .eq('id', pair_job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch pair job: ${fetchError.message}`);
    if (!pairJob) throw new Error(`Pair job with ID ${pair_job_id} not found.`);

    const { user_id, source_person_image_url, source_garment_image_url, prompt_appendix } = pairJob;

    console.log(`[BatchInpaintWorker][${pair_job_id}] Downloading images...`);
    const [personBlob, garmentBlob] = await Promise.all([
        downloadFromSupabase(supabase, source_person_image_url),
        downloadFromSupabase(supabase, source_garment_image_url)
    ]);
    
    const [personBase64, garmentBase64] = await Promise.all([
        blobToBase64(personBlob),
        blobToBase64(garmentBlob)
    ]);
    console.log(`[BatchInpaintWorker][${pair_job_id}] Images downloaded and encoded.`);

    const { loadImage } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
    const personImageBuffer = await personBlob.arrayBuffer();
    const personImage = await loadImage(new Uint8Array(personImageBuffer));
    const image_dimensions = { width: personImage.width(), height: personImage.height() };

    console.log(`[BatchInpaintWorker][${pair_job_id}] Invoking segmentation orchestrator...`);
    const { data: segmentationData, error: segmentationError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-segmentation', {
        body: {
            user_id: user_id,
            image_base64: personBase64,
            mime_type: personBlob.type,
            reference_image_base64: garmentBase64,
            reference_mime_type: garmentBlob.type,
            image_dimensions,
        }
    });
    if (segmentationError) throw new Error(`Segmentation failed: ${segmentationError.message}`);
    const mask_image_url = segmentationData.finalMaskUrl;
    console.log(`[BatchInpaintWorker][${pair_job_id}] Segmentation complete. Mask URL: ${mask_image_url}`);

    console.log(`[BatchInpaintWorker][${pair_job_id}] Generating prompt...`);
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
    console.log(`[BatchInpaintWorker][${pair_job_id}] Prompt generated: "${finalPrompt.substring(0, 60)}..."`);

    console.log(`[BatchInpaintWorker][${pair_job_id}] Queuing final inpainting job...`);
    const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
        body: {
            mode: 'inpaint',
            user_id: user_id,
            full_source_image_base64: personBase64,
            mask_image_url: mask_image_url,
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
    console.log(`[BatchInpaintWorker][${pair_job_id}] Pair processed and job queued successfully. Inpainting Job ID: ${inpaintingJobId}`);
    
    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
        .update({ status: 'delegated', inpainting_job_id: inpaintingJobId })
        .eq('id', pair_job_id);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[BatchInpaintWorker][${pair_job_id}] Error:`, error);
    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
      .update({ status: 'failed', error_message: error.message })
      .eq('id', pair_job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});