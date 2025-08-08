import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TMP_BUCKET = 'mira-agent-user-uploads';
const BBOX_PADDING_PERCENTAGE = 0.10; // 10% padding

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

async function invokeWithRetry(supabase: SupabaseClient, functionName: string, payload: object, maxRetries = 3, logPrefix = "") {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const { data, error } = await supabase.functions.invoke(functionName, payload);
            if (error) {
                throw new Error(error.message || 'Function invocation failed with an unknown error.');
            }
            console.log(`${logPrefix} Successfully invoked ${functionName} on attempt ${attempt}.`);
            return data; // Success, return data
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            console.warn(`${logPrefix} Invocation of '${functionName}' failed on attempt ${attempt}/${maxRetries}. Error: ${lastError.message}`);
            if (attempt < maxRetries) {
                const delay = 20000 * Math.pow(2, attempt - 1); // 20s, 40s, 80s...
                console.warn(`${logPrefix} Waiting ${delay}ms before retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    // If all retries fail, throw the last error
    throw lastError || new Error(`Function ${functionName} failed after all retries without a specific error.`);
}

function parseStorageURL(url: string) {
  const u = new URL(url);
  const pathSegments = u.pathname.split('/');
  const objectSegmentIndex = pathSegments.indexOf('object');
  if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
    throw new Error(`Invalid Supabase storage URL format: ${url}`);
  }
  const bucket = pathSegments[objectSegmentIndex + 2];
  const path = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
  return {
    bucket,
    path
  };
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string) {
  const { bucket, path } = parseStorageURL(publicUrl);
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Failed to download from Supabase storage (${path}): ${error.message}`);
  return data;
}

async function uploadBuffer(buffer: Uint8Array, supabase: SupabaseClient) {
  const path = `tmp/${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from(TMP_BUCKET).upload(path, buffer, {
    contentType: "image/png"
  });
  if (error) throw error;
  const { data } = await supabase.storage.from(TMP_BUCKET).createSignedUrl(path, 3600); // 1 hour TTL
  if (!data || !data.signedUrl) throw new Error("Failed to create signed URL for temporary file.");
  return data.signedUrl;
}

serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const { pair_job_id, final_mask_url } = await req.json();
  const logPrefix = `[BatchInpaintWorker-Step2][${pair_job_id}]`;
  console.log(`${logPrefix} Received payload. pair_job_id: ${pair_job_id}, final_mask_url: ${final_mask_url}`);
  if (!pair_job_id || !final_mask_url) {
    console.error(`${logPrefix} Missing required parameters.`);
    return new Response(JSON.stringify({
      error: "pair_job_id and final_mask_url are required."
    }), {
      status: 400,
      headers: corsHeaders
    });
  }
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  try {
    // --- ATOMIC UPDATE TO CLAIM THE JOB ---
    console.log(`${logPrefix} Attempting to claim job by updating status from 'mask_expanded' to 'processing_step_2'.`);
    const { count, error: claimError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
      status: 'processing_step_2',
      updated_at: new Date().toISOString()
    }).eq('id', pair_job_id).eq('status', 'mask_expanded');
    if (claimError) {
      console.error(`${logPrefix} Error trying to claim job:`, claimError.message);
      throw claimError;
    }
    if (count === 0) {
      console.log(`${logPrefix} Job was already claimed by another instance or is not in 'mask_expanded' state. Exiting gracefully.`);
      return new Response(JSON.stringify({
        success: true,
        message: "Job already claimed or not in a valid state."
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 200
      });
    }
    console.log(`${logPrefix} Successfully claimed job.`);
    // --- END OF ATOMIC UPDATE ---
    const { data: pairJob, error: fetchError } = await supabase.from('mira-agent-batch-inpaint-pair-jobs').select('*').eq('id', pair_job_id).single();
    if (fetchError) throw new Error(`Failed to fetch pair job: ${fetchError.message}`);
    if (!pairJob) throw new Error(`Pair job with ID ${pair_job_id} not found.`);
    const { user_id, source_person_image_url, source_garment_image_url, prompt_appendix, metadata } = pairJob;
    console.log(`${logPrefix} Downloading source and mask images...`);
    const [sourceBlob, maskBlob] = await Promise.all([
      downloadFromSupabase(supabase, source_person_image_url),
      downloadFromSupabase(supabase, final_mask_url)
    ]);
    console.log(`${logPrefix} Images downloaded.`);
    console.log(`${logPrefix} Decoding images...`);
    const [sourceImage, maskImage] = await Promise.all([
      ISImage.decode(await sourceBlob.arrayBuffer()),
      ISImage.decode(await maskBlob.arrayBuffer())
    ]);
    const { width, height } = sourceImage;
    console.log(`${logPrefix} Images decoded. Source dimensions: ${width}x${height}.`);
    console.log(`[BBoxCalculator][${pair_job_id}] Starting bounding box calculation.`);
    const startTime = performance.now();
    let minX = width, minY = height, maxX = 0, maxY = 0;
    for (const [x, y, color] of maskImage.iterateWithColors()){
      const redChannel = ISImage.colorToRGBA(color)[0];
      if (redChannel > 128) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX) {
      console.warn(`[BBoxCalculator][${pair_job_id}] WARNING: Mask appears to be empty. No bounding box generated.`);
      throw new Error("Mask is empty.");
    }
    const padding = Math.round(Math.max(maxX - minX, maxY - minY) * BBOX_PADDING_PERCENTAGE);
    const bbox = {
      x: Math.max(0, minX - padding),
      y: Math.max(0, minY - padding),
      width: Math.min(width, maxX + padding) - Math.max(0, minX - padding),
      height: Math.min(height, maxY + padding) - Math.max(0, minY - padding)
    };
    const endTime = performance.now();
    console.log(`[BBoxCalculator][${pair_job_id}] Bounding box calculated in ${(endTime - startTime).toFixed(2)}ms. Padded BBox: { x: ${bbox.x}, y: ${bbox.y}, w: ${bbox.width}, h: ${bbox.height} }`);
    const croppedSourceImage = sourceImage.clone().crop(bbox.x, bbox.y, bbox.width, bbox.height);
    const croppedSourceBuffer = await croppedSourceImage.encodeJPEG(75);
    const croppedPersonBlob = new Blob([
      croppedSourceBuffer
    ], {
      type: 'image/jpeg'
    });
    const tempPersonPath = `tmp/${pairJob.user_id}/${Date.now()}-cropped_person.jpeg`;
    await supabase.storage.from(TMP_BUCKET).upload(tempPersonPath, croppedPersonBlob, {
      contentType: "image/jpeg"
    });
    const { data: { publicUrl: source_cropped_url } } = supabase.storage.from(TMP_BUCKET).getPublicUrl(tempPersonPath);
    console.log(`${logPrefix} Cropped person image uploaded to temp storage.`);
    const promptData = await invokeWithRetry(supabase, 'MIRA-AGENT-tool-vto-prompt-helper', {
      body: {
        person_image_url: source_cropped_url,
        garment_image_url: source_garment_image_url,
        prompt_appendix: prompt_appendix,
        is_helper_enabled: metadata?.is_helper_enabled !== false,
        is_garment_mode: true
      }
    }, 3, logPrefix);
    const finalPrompt = promptData.final_prompt;
    console.log(`${logPrefix} Prompt generated successfully.`);

    // --- NEW: Check for existing BitStudio job before invoking proxy ---
    const { data: existingBitstudioJob, error: checkError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id')
      .eq('batch_pair_job_id', pair_job_id)
      .maybeSingle();
    if (checkError) throw checkError;

    const proxyPayload = {
      mode: 'inpaint',
      user_id: user_id,
      source_cropped_url: source_cropped_url,
      mask_url: final_mask_url,
      prompt: finalPrompt,
      reference_image_url: source_garment_image_url,
      denoise: metadata?.denoise || 0.95,
      resolution: 'standard',
      num_images: 1,
      batch_pair_job_id: pair_job_id,
      vto_pack_job_id: metadata?.vto_pack_job_id,
      metadata: {
        ...metadata,
        bbox: bbox,
        full_source_image_url: source_person_image_url,
        final_mask_url: final_mask_url
      },
      retry_job_id: existingBitstudioJob ? existingBitstudioJob.id : null // Pass the ID if it's a retry
    };

    const proxyData = await invokeWithRetry(supabase, 'MIRA-AGENT-proxy-bitstudio', { body: proxyPayload }, 3, logPrefix);
    
    console.log(`${logPrefix} BitStudio proxy invoked successfully.`);
    const inpaintingJobId = proxyData?.jobId;
    if (!inpaintingJobId) throw new Error('Delegation failed: Proxy did not return a valid job ID.');
    
    await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
      status: 'delegated',
      inpainting_job_id: inpaintingJobId,
      metadata: {
        ...metadata,
        prompt_used: finalPrompt
      }
    }).eq('id', pair_job_id);
    console.log(`${logPrefix} Inpainting job queued successfully. Parent job status updated to 'delegated'. Inpainting Job ID: ${inpaintingJobId}`);
    return new Response(JSON.stringify({
      success: true
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
      status: 'failed',
      error_message: error.message
    }).eq('id', pair_job_id);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});