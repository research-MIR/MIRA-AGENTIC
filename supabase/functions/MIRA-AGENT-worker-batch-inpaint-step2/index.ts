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

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
  const { bucket, path } = parseStorageURL(publicUrl);
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw new Error(`Failed to download from Supabase storage (${path}): ${error.message}`);
  return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }

  const { pair_job_id } = await req.json();
  const logPrefix = `[BatchInpaintWorker-Step2][${pair_job_id}]`;
  console.log(`${logPrefix} Worker invoked.`);

  if (!pair_job_id) {
    console.error(`${logPrefix} Missing required parameter: pair_job_id.`);
    return new Response(JSON.stringify({
      error: "pair_job_id is required."
    }), {
      status: 400,
      headers: corsHeaders
    });
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

    const { user_id, source_person_image_url, source_garment_image_url, prompt_appendix, metadata } = pairJob;
    const final_mask_url = metadata?.debug_assets?.expanded_mask_url;

    if (!final_mask_url) {
        throw new Error("Cannot proceed to step 2: expanded_mask_url is missing from job metadata.");
    }

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
    for (const [x, y, color] of maskImage.iterateWithColors()) {
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
      height: Math.min(height, maxY + padding) - Math.max(0, minY - padding),
    };
    const endTime = performance.now();
    console.log(`[BBoxCalculator][${pair_job_id}] Bounding box calculated in ${(endTime - startTime).toFixed(2)}ms. Padded BBox: { x: ${bbox.x}, y: ${bbox.y}, w: ${bbox.width}, h: ${bbox.height} }`);

    const croppedSourceImage = sourceImage.clone().crop(bbox.x, bbox.y, bbox.width, bbox.height);
    const croppedSourceBuffer = await croppedSourceImage.encodeJPEG(75);
    const croppedPersonBlob = new Blob([croppedSourceBuffer], { type: 'image/jpeg' });
    const tempPersonPath = `tmp/${pairJob.user_id}/${Date.now()}-cropped_person.jpeg`;
    await supabase.storage.from(TMP_BUCKET).upload(tempPersonPath, croppedPersonBlob, { contentType: "image/jpeg" });
    const { data: { publicUrl: source_cropped_url } } = supabase.storage.from(TMP_BUCKET).getPublicUrl(tempPersonPath);
    console.log(`${logPrefix} Cropped person image uploaded to temp storage.`);

    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
      body: {
        person_image_url: source_cropped_url,
        garment_image_url: source_garment_image_url,
        prompt_appendix: prompt_appendix,
        is_helper_enabled: metadata?.is_helper_enabled !== false,
        is_garment_mode: true
      }
    });
    if (promptError) throw new Error(`Prompt generation failed: ${promptError.message}`);
    const finalPrompt = promptData.final_prompt;
    console.log(`${logPrefix} Prompt generated successfully.`);

    const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
      body: {
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
        }
      }
    });
    if (proxyError) throw proxyError;
    console.log(`${logPrefix} BitStudio proxy invoked successfully.`);

    const inpaintingJobId = proxyData?.jobIds?.[0];
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

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({
      status: 'failed',
      error_message: error.message
    }).eq('id', pair_job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});