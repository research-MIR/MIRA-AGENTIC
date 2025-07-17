import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TMP_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function parseStorageURL(url: string) {
    const u = new URL(url);
    const pathSegments = u.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Invalid Supabase storage URL format: ${url}`);
    }
    const bucket = pathSegments[objectSegmentIndex + 2];
    const path = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    return { bucket, path };
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const { bucket, path } = parseStorageURL(publicUrl);
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) throw new Error(`Failed to download from Supabase storage (${path}): ${error.message}`);
    return data;
}

async function uploadBuffer(buffer: Uint8Array, supabase: SupabaseClient) {
  const path = `tmp/${crypto.randomUUID()}.png`;
  const { error } = await supabase.storage.from(TMP_BUCKET).upload(
    path,
    buffer,
    { contentType: "image/png" },
  );
  if (error) throw error;
  const { data } = await supabase.storage.from(TMP_BUCKET)
    .createSignedUrl(path, 3600); // 1 hour TTL
  if (!data || !data.signedUrl) throw new Error("Failed to create signed URL for temporary file.");
  return data.signedUrl;
}

serve(async (req) => {
  console.log(`[BatchInpaintWorker-Step2] Function invoked.`);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { pair_job_id, final_mask_url } = await req.json();
  const logPrefix = `[BatchInpaintWorker-Step2][${pair_job_id}]`;
  console.log(`${logPrefix} Received payload. pair_job_id: ${pair_job_id}, final_mask_url: ${final_mask_url}`);

  if (!pair_job_id || !final_mask_url) {
    console.error(`${logPrefix} Missing required parameters.`);
    return new Response(JSON.stringify({ error: "pair_job_id and final_mask_url are required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: pairJob, error: fetchError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('*')
      .eq('id', pair_job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch pair job: ${fetchError.message}`);
    if (!pairJob) throw new Error(`Pair job with ID ${pair_job_id} not found.`);

    if (pairJob.inpainting_job_id) {
        console.warn(`${logPrefix} Safety check triggered. Inpainting job already exists (${pairJob.inpainting_job_id}). This is a duplicate invocation. Exiting gracefully.`);
        return new Response(JSON.stringify({ success: true, message: "Duplicate invocation detected, exiting." }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    const { user_id, source_person_image_url, source_garment_image_url, prompt_appendix, metadata } = pairJob;
    
    console.log(`${logPrefix} Downloading source and mask images...`);
    const [sourceBlob, maskBlob] = await Promise.all([
        downloadFromSupabase(supabase, source_person_image_url),
        downloadFromSupabase(supabase, final_mask_url)
    ]);

    console.log(`${logPrefix} Decoding images...`);
    const [sourceImage, maskImage] = await Promise.all([
        ISImage.decode(await sourceBlob.arrayBuffer()),
        ISImage.decode(await maskBlob.arrayBuffer()),
    ]);

    const { width, height } = sourceImage;

    // --- CORRECTED & OPTIMIZED BOUNDING BOX CALCULATION ---
    console.log(`[BBoxCalculator][${pair_job_id}] Starting bounding box calculation. Original mask dimensions: ${width}x${height}.`);
    const startTime = performance.now();

    const THUMBNAIL_SIZE = 200;
    const scaleFactor = Math.max(width, height) / THUMBNAIL_SIZE;
    const thumbWidth = Math.round(width / scaleFactor);
    const thumbHeight = Math.round(height / scaleFactor);

    console.log(`[BBoxCalculator][${pair_job_id}] Using 'Thumbnail-First' method. Down-scaling mask to ${thumbWidth}x${thumbHeight}.`);
    const thumbnail = maskImage.clone().resize(thumbWidth, ISImage.RESIZE_NEAREST_NEIGHBOR);

    let minX = thumbWidth, minY = thumbHeight, maxX = 0, maxY = 0;
    for (const [x, y, color] of thumbnail.iterateWithColors()) {
        const redChannel = ISImage.colorToRGBA(color)[0]; // Check the red channel for white
        if (redChannel > 128) { // White pixels will have high red channel value
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    
    console.log(`[BBoxCalculator][${pair_job_id}] Thumbnail scan complete. Found thumbnail BBox at { x: ${minX}, y: ${minY}, w: ${maxX - minX}, h: ${maxY - minY} }.`);

    if (maxX < minX) {
        console.warn(`[BBoxCalculator][${pair_job_id}] WARNING: Mask appears to be empty. No bounding box generated.`);
        throw new Error("Mask is empty.");
    }

    const scaledMinX = Math.floor(minX * scaleFactor);
    const scaledMinY = Math.floor(minY * scaleFactor);
    const scaledMaxX = Math.ceil(maxX * scaleFactor);
    const scaledMaxY = Math.ceil(maxY * scaleFactor);
    
    const padding = Math.round(Math.max(scaledMaxX - scaledMinX, scaledMaxY - scaledMinY) * 0.05);
    const bbox = {
      x: Math.max(0, scaledMinX - padding),
      y: Math.max(0, scaledMinY - padding),
      width:  Math.min(width,  (scaledMaxX + padding)) - Math.max(0, scaledMinX - padding),
      height: Math.min(height, (scaledMaxY + padding)) - Math.max(0, scaledMinY - padding),
    };
    
    const endTime = performance.now();
    console.log(`[BBoxCalculator][${pair_job_id}] Final bounding box calculated. Padded BBox:`, bbox);
    console.log(`[BBoxCalculator][${pair_job_id}] Calculation finished. PERF: Total execution time: ${(endTime - startTime).toFixed(2)}ms.`);
    // --- END OF CORRECTION ---

    const croppedSourceImage = sourceImage.clone().crop(bbox.x, bbox.y, bbox.width, bbox.height);
    const croppedSourceBuffer = await croppedSourceImage.encode(0);
    const source_cropped_url = await uploadBuffer(croppedSourceBuffer, supabase);

    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
        body: {
            person_image_url: source_cropped_url,
            garment_image_url: source_garment_image_url,
            prompt_appendix: prompt_appendix,
            is_helper_enabled: metadata?.is_helper_enabled !== false,
            is_garment_mode: true,
        }
    });
    if (promptError) throw new Error(`Prompt generation failed: ${promptError.message}`);
    const finalPrompt = promptData.final_prompt;
    console.log(`${logPrefix} Prompt generated.`);

    const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
        body: { 
            mode: 'inpaint',
            user_id: user_id,
            source_cropped_url: source_cropped_url,
            mask_url: final_mask_url,
            prompt: finalPrompt,
            reference_image_url: source_garment_image_url,
            denoise: 0.99,
            resolution: 'standard',
            num_images: 1,
            batch_pair_job_id: pair_job_id,
            metadata: {
                ...metadata,
                bbox: bbox,
                full_source_image_url: source_person_image_url,
            }
        }
    });
    if (proxyError) throw new Error(`Job queuing failed: ${proxyError.message}`);
    
    const inpaintingJobId = proxyData?.jobIds?.[0];
    if (!inpaintingJobId) throw new Error('Delegation failed: Proxy did not return a valid job ID.');

    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
        .update({ status: 'delegated', inpainting_job_id: inpaintingJobId, metadata: { ...metadata, prompt_used: finalPrompt } })
        .eq('id', pair_job_id);

    console.log(`${logPrefix} Inpainting job queued successfully. Inpainting Job ID: ${inpaintingJobId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
      .update({ status: 'failed', error_message: error.message })
      .eq('id', pair_job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});