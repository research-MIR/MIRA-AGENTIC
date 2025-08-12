import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(new Uint8Array(buffer));
};

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Could not parse bucket name from Supabase URL: ${publicUrl}`);
    }
    
    const bucketName = pathSegments[objectSegmentIndex + 2];
    const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));

    if (!bucketName || !filePath) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
    }

    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) {
        throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    }
    return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  let pair_job_id: string | null = null;

  try {
    const { pair_job_id: id, final_mask_url } = await req.json();
    pair_job_id = id;
    if (!pair_job_id || !final_mask_url) {
      throw new Error("pair_job_id and final_mask_url are required.");
    }

    const logPrefix = `[BatchInpaintWorker-Step2][${pair_job_id}]`;
    console.log(`${logPrefix} Invoked. Starting Step 2: Inpainting.`);

    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
        .update({ status: 'processing_step_2' })
        .eq('id', pair_job_id);

    const { data: pairJob, error: fetchError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('*')
      .eq('id', pair_job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch pair job: ${fetchError.message}`);
    if (!pairJob) throw new Error(`Pair job with ID ${pair_job_id} not found.`);

    const { user_id, source_person_image_url, source_garment_image_url, prompt_appendix, metadata } = pairJob;

    console.log(`${logPrefix} Downloading assets for inpainting...`);
    const [personBlob, maskBlob, garmentBlob] = await Promise.all([
        downloadFromSupabase(supabase, source_person_image_url),
        downloadFromSupabase(supabase, final_mask_url),
        downloadFromSupabase(supabase, source_garment_image_url)
    ]);
    
    const [personBase64, maskBase64, garmentBase64] = await Promise.all([
        blobToBase64(personBlob),
        blobToBase64(maskBlob),
        blobToBase64(garmentBlob)
    ]);
    console.log(`${logPrefix} Assets downloaded and encoded.`);

    const isHelperEnabled = metadata?.is_helper_enabled !== false;
    let finalPrompt = prompt_appendix;

    if (isHelperEnabled) {
        console.log(`${logPrefix} AI Helper is enabled. Synthesizing prompt...`);
        const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
            body: {
                person_image_base64: personBase64,
                garment_image_base64: garmentBase64,
                prompt_appendix: prompt_appendix,
                is_garment_mode: true,
                is_helper_enabled: true
            }
        });
        if (promptError) throw new Error(`Prompt synthesis failed: ${promptError.message}`);
        finalPrompt = promptData.final_prompt;
    }

    console.log(`${logPrefix} Invoking inpainting proxy with final prompt: "${finalPrompt}"`);
    const { data: inpaintData, error: inpaintError } = await supabase.functions.invoke('MIRA-AGENT-proxy-inpainting', {
        body: {
            user_id: user_id,
            source_image_base64: personBase64,
            mask_image_base64: maskBase64,
            reference_image_base64: garmentBase64,
            prompt: finalPrompt,
            is_garment_mode: true
        }
    });

    if (inpaintError) throw new Error(`Inpainting failed: ${inpaintError.message}`);
    
    const inpaintingJobId = inpaintData.jobId;
    if (!inpaintingJobId) {
        throw new Error("Inpainting proxy did not return a valid job ID.");
    }
    console.log(`${logPrefix} Inpainting job created: ${inpaintingJobId}.`);

    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
        .update({ 
            status: 'delegated', 
            inpainting_job_id: inpaintingJobId,
            metadata: { ...metadata, final_prompt_used: finalPrompt }
        })
        .eq('id', pair_job_id);

    console.log(`${logPrefix} Pair job updated. Worker finished step 2.`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    const logPrefix = `[BatchInpaintWorker-Step2][${pair_job_id || 'unclaimed'}]`;
    console.error(`${logPrefix} Error:`, error.message);
    if (pair_job_id) {
        const { data: jobToFail, error: fetchError } = await supabase
            .from('mira-agent-batch-inpaint-pair-jobs')
            .select('retry_count')
            .eq('id', pair_job_id)
            .single();

        if (fetchError) {
            console.error(`${logPrefix} Could not fetch job to update retry count. Failing permanently.`, fetchError);
            await supabase.from('mira-agent-batch-inpaint-pair-jobs')
              .update({ status: 'failed', error_message: `Processing failed and could not update retry count: ${error.message}` })
              .eq('id', pair_job_id);
        } else {
            const MAX_RETRIES = 2; // This means 3 attempts total (initial + 2 retries)
            const currentRetries = jobToFail.retry_count || 0;

            if (currentRetries < MAX_RETRIES) {
                console.log(`${logPrefix} Attempt ${currentRetries + 1} failed. Re-queueing for another attempt.`);
                await supabase.from('mira-agent-batch-inpaint-pair-jobs')
                  .update({ 
                      status: 'pending', // Re-queue it for the watchdog
                      error_message: `Attempt ${currentRetries + 1} failed: ${error.message}`,
                      retry_count: currentRetries + 1 
                  })
                  .eq('id', pair_job_id);
            } else {
                console.error(`${logPrefix} Max retries (${MAX_RETRIES}) reached. Marking job as permanently failed.`);
                await supabase.from('mira-agent-batch-inpaint-pair-jobs')
                  .update({ status: 'failed', error_message: `Failed after ${MAX_RETRIES + 1} attempts: ${error.message}` })
                  .eq('id', pair_job_id);
            }
        }
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});