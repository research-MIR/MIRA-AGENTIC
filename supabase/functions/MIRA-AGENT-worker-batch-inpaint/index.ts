import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { imageSize } from "https://deno.land/x/imagesize@0.1.0/mod.ts";

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

async function getDimensionsFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<{width: number, height: number}> {
    const url = new URL(publicUrl);
    const pathStartIndex = url.pathname.indexOf(UPLOAD_BUCKET);
    if (pathStartIndex === -1) throw new Error(`Could not find bucket name '${UPLOAD_BUCKET}' in URL path.`);
    const filePath = decodeURIComponent(url.pathname.substring(pathStartIndex + UPLOAD_BUCKET.length + 1));

    // Download only the first 64KB, which is more than enough for image headers.
    const { data: fileHead, error } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath, { range: '0-65535' });
    if (error) throw new Error(`Failed to download image header: ${error.message}`);

    const size = imageSize(await fileHead.arrayBuffer());
    if (!size) throw new Error("Could not determine image dimensions from file header.");
    
    return { width: size.width, height: size.height };
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
  console.log(`[BatchInpaintWorker][${pair_job_id}] Starting Step 1: Segmentation.`);

  try {
    const { data: pairJob, error: fetchError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('*')
      .eq('id', pair_job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch pair job: ${fetchError.message}`);
    if (!pairJob) throw new Error(`Pair job with ID ${pair_job_id} not found.`);

    const { user_id, source_person_image_url, source_garment_image_url } = pairJob;

    console.log(`[BatchInpaintWorker][${pair_job_id}] Downloading images...`);
    let [personBlob, garmentBlob] = await Promise.all([
        downloadFromSupabase(supabase, source_person_image_url),
        downloadFromSupabase(supabase, source_garment_image_url)
    ]);
    
    let [personBase64, garmentBase64] = await Promise.all([
        blobToBase64(personBlob),
        blobToBase64(garmentBlob)
    ]);
    console.log(`[BatchInpaintWorker][${pair_job_id}] Images downloaded and encoded.`);
    
    // Nullify large variables as soon as they are no longer needed to help GC.
    personBlob = null;
    garmentBlob = null;

    const image_dimensions = await getDimensionsFromSupabase(supabase, source_person_image_url);
    console.log(`[BatchInpaintWorker][${pair_job_id}] Image dimensions determined: ${image_dimensions.width}x${image_dimensions.height}`);

    console.log(`[BatchInpaintWorker][${pair_job_id}] Invoking segmentation orchestrator...`);
    const { data: segmentationData, error: segmentationError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-segmentation', {
        body: {
            user_id: user_id,
            image_base64: personBase64,
            mime_type: 'image/png', // We can assume PNG as we're not checking type anymore
            reference_image_base64: garmentBase64,
            reference_mime_type: 'image/png',
            image_dimensions,
        }
    });

    // Nullify the largest variables after the function call.
    personBase64 = null;
    garmentBase64 = null;

    if (segmentationError) throw new Error(`Segmentation failed: ${segmentationError.message}`);
    
    const aggregationJobId = segmentationData.aggregationJobId;
    if (!aggregationJobId) {
        throw new Error("Orchestrator did not return a valid aggregationJobId.");
    }
    console.log(`[BatchInpaintWorker][${pair_job_id}] Segmentation job created: ${aggregationJobId}.`);

    // Update the pair job with the aggregation ID and set status to 'segmenting'
    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
        .update({ status: 'segmenting', metadata: { ...pairJob.metadata, aggregation_job_id: aggregationJobId } })
        .eq('id', pair_job_id);

    console.log(`[BatchInpaintWorker][${pair_job_id}] Pair job updated with aggregation ID. Worker finished step 1.`);

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