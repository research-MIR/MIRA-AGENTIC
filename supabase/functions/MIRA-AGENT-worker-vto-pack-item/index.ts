import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import imageSize from "https://esm.sh/image-size";

// --- Global Error Handlers for Observability ---
self.addEventListener("error", (evt) => {
  console.error("[GLOBAL ERROR]", evt.error);
});
self.addEventListener("unhandledrejection", (evt) => {
  console.error("[GLOBAL UNHANDLED REJECTION]", evt.reason);
});
// ------------------------------------------------

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TEMP_UPLOAD_BUCKET = 'mira-agent-user-uploads';
const GENERATED_IMAGES_BUCKET = 'mira-generations';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Hardened Safe Wrapper Functions ---

async function safeInvoke(supabase: SupabaseClient, functionName: string, payload: object) {
  const { data, error } = await supabase.functions.invoke(functionName, { body: payload })
    .catch((e) => { throw e ?? new Error(`[${functionName}] rejected with null`); });

  if (error) throw error ?? new Error(`[${functionName}] error was null`);
  if (data == null) throw new Error(`[${functionName}] data missing`);
  return data;
}

async function safeDownload(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const { bucket, path } = parseStorageURL(publicUrl);
    const { data, error } = await supabase.storage.from(bucket).download(path)
        .catch((e) => { throw e ?? new Error(`[safeDownload:${path}] rejected with null`); });
    
    if (error) throw error ?? new Error(`[safeDownload:${path}] error was null`);
    if (!data) throw new Error(`[safeDownload:${path}] data missing`);
    return data;
}

async function safeUpload(supabase: SupabaseClient, bucket: string, path: string, body: Blob | Uint8Array, options: object) {
    const { error } = await supabase.storage.from(bucket).upload(path, body, options)
        .catch((e) => { throw e ?? new Error(`[safeUpload:${path}] rejected with null`); });
    if (error) throw error ?? new Error(`[safeUpload:${path}] error was null`);
}

async function safeGetPublicUrl(supabase: SupabaseClient, bucket: string, path: string) {
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    if (!data || !data.publicUrl) throw new Error(`[safeGetPublicUrl:${path}] Failed to create public URL.`);
    return data.publicUrl;
}

// --- Utility Functions ---

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

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(buffer);
};

// --- State Machine Logic ---

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { pair_job_id } = await req.json();
  if (!pair_job_id) {
    return new Response(JSON.stringify({ error: "pair_job_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-Pack-Worker][${pair_job_id}]`;

  try {
    console.log(`${logPrefix} Starting job.`);
    const { data: job, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', pair_job_id).single();
    if (fetchError) throw fetchError;

    const step = job.metadata?.google_vto_step || 'start';
    console.log(`${logPrefix} Current step: ${step}`);

    switch (step) {
      case 'start':
        await handleStart(supabase, job, logPrefix);
        break;
      case 'generate_step_1':
        await handleGenerateStep(supabase, job, 15, 'generate_step_2', logPrefix);
        break;
      case 'generate_step_2':
        await handleGenerateStep(supabase, job, 30, 'generate_step_3', logPrefix);
        break;
      case 'generate_step_3':
        await handleGenerateStep(supabase, job, 55, 'quality_check', logPrefix);
        break;
      case 'quality_check':
        await handleQualityCheck(supabase, job, logPrefix);
        break;
      case 'compositing':
        await handleCompositing(supabase, job, logPrefix);
        break;
      default:
        throw new Error(`Unknown step: ${step}`);
    }

    return new Response(JSON.stringify({ success: true, message: `Step '${step}' processed.` }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', pair_job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});

async function handleStart(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Step 1: Getting bounding box and optimizing images.`);
  const bboxData = await safeInvoke(supabase, 'MIRA-AGENT-orchestrator-bbox', { image_url: job.source_person_image_url });
  
  const personBox = bboxData?.person;
  if (!personBox || !Array.isArray(personBox) || personBox.length !== 4 || personBox.some((v: any) => typeof v !== 'number')) {
    throw new Error("Orchestrator did not return a valid bounding box array.");
  }
  console.log(`${logPrefix} Bounding box received.`);

  let [personBlob, garmentBlob] = await Promise.all([
    safeDownload(supabase, job.source_person_image_url),
    safeDownload(supabase, job.source_garment_image_url)
  ]);

  console.log(`${logPrefix} Original blob sizes - Person: ${personBlob.size} bytes, Garment: ${garmentBlob.size} bytes.`);

  const personImage = await ISImage.decode(await personBlob.arrayBuffer());
  personBlob = null; // GC
  const { width: originalWidth, height: originalHeight } = personImage;

  const abs_x = Math.floor((personBox[1] / 1000) * originalWidth);
  const abs_y = Math.floor((personBox[0] / 1000) * originalHeight);
  const abs_width = Math.ceil(((personBox[3] - personBox[1]) / 1000) * originalWidth);
  const abs_height = Math.ceil(((personBox[2] - personBox[0]) / 1000) * originalHeight);
  
  const bbox = {
    x: Math.max(0, Math.min(abs_x, originalWidth - 1)),
    y: Math.max(0, Math.min(abs_y, originalHeight - 1)),
    width: Math.max(1, Math.min(abs_width, originalWidth - abs_x)),
    height: Math.max(1, Math.min(abs_height, originalHeight - abs_y)),
  };
  
  const croppedPersonImage = personImage.clone().crop(bbox.x, bbox.y, bbox.width, bbox.height);
  const croppedPersonBuffer = await croppedPersonImage.encodeJPEG(75);
  console.log(`${logPrefix} Cropped person JPEG buffer size: ${croppedPersonBuffer.length} bytes.`);
  const croppedPersonBlob = new Blob([croppedPersonBuffer], { type: 'image/jpeg' });
  
  const tempPersonPath = `tmp/${job.user_id}/${Date.now()}-cropped_person.jpeg`;
  await safeUpload(supabase, TEMP_UPLOAD_BUCKET, tempPersonPath, croppedPersonBlob, { contentType: "image/jpeg" });
  const croppedPersonUrl = await safeGetPublicUrl(supabase, TEMP_UPLOAD_BUCKET, tempPersonPath);
  console.log(`${logPrefix} Cropped person image uploaded to temp storage.`);

  const garmentImage = await ISImage.decode(await garmentBlob.arrayBuffer());
  garmentBlob = null; // GC
  const MAX_GARMENT_DIMENSION = 2048;
  if (Math.max(garmentImage.width, garmentImage.height) > MAX_GARMENT_DIMENSION) {
      garmentImage.resize(
          garmentImage.width > garmentImage.height ? MAX_GARMENT_DIMENSION : ISImage.RESIZE_AUTO,
          garmentImage.height > garmentImage.width ? MAX_GARMENT_DIMENSION : ISImage.RESIZE_AUTO
      );
  }
  const optimizedGarmentBuffer = await garmentImage.encodeJPEG(75);
  console.log(`${logPrefix} Optimized garment JPEG buffer size: ${optimizedGarmentBuffer.length} bytes.`);
  const optimizedGarmentBlob = new Blob([optimizedGarmentBuffer], { type: 'image/jpeg' });
  const tempGarmentPath = `tmp/${job.user_id}/${Date.now()}-optimized_garment.jpeg`;
  await safeUpload(supabase, TEMP_UPLOAD_BUCKET, tempGarmentPath, optimizedGarmentBlob, { contentType: "image/jpeg" });
  const optimizedGarmentUrl = await safeGetPublicUrl(supabase, TEMP_UPLOAD_BUCKET, tempGarmentPath);
  console.log(`${logPrefix} Optimized garment image uploaded to temp storage.`);

  await supabase.from('mira-agent-bitstudio-jobs').update({
    status: 'processing',
    metadata: { 
        ...job.metadata, 
        bbox, 
        cropped_person_url: croppedPersonUrl, 
        optimized_garment_url: optimizedGarmentUrl,
        google_vto_step: 'generate_step_1' 
    }
  }).eq('id', job.id);

  await safeInvoke(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function handleGenerateStep(supabase: SupabaseClient, job: any, sampleStep: number, nextStep: string, logPrefix: string) {
  console.log(`${logPrefix} Generating variation with ${sampleStep} steps.`);
  
  const data = await safeInvoke(supabase, 'MIRA-AGENT-tool-virtual-try-on', {
    person_image_url: job.metadata.cropped_person_url,
    garment_image_url: job.metadata.optimized_garment_url,
    sample_count: 1,
    sample_step: sampleStep
  });

  const generatedImages = data?.generatedImages;
  if (!generatedImages || !Array.isArray(generatedImages) || generatedImages.length === 0 || !generatedImages[0]?.base64Image) {
    throw new Error(`VTO tool did not return a valid image for step ${sampleStep}`);
  }

  const newVariation = generatedImages[0];
  const currentVariations = job.metadata.generated_variations || [];

  await supabase.from('mira-agent-bitstudio-jobs').update({
    metadata: { ...job.metadata, generated_variations: [...currentVariations, newVariation], google_vto_step: nextStep }
  }).eq('id', job.id);

  console.log(`${logPrefix} Step ${sampleStep} complete. Advancing to ${nextStep}.`);
  await safeInvoke(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function handleQualityCheck(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Performing quality check on 3 variations.`);
  const variations = job.metadata.generated_variations;
  if (!variations || !Array.isArray(variations) || variations.length < 3) {
    throw new Error("Not enough variations generated for quality check.");
  }

  let [personBlob, garmentBlob] = await Promise.all([
    safeDownload(supabase, job.source_person_image_url),
    safeDownload(supabase, job.source_garment_image_url)
  ]);

  const qaData = await safeInvoke(supabase, 'MIRA-AGENT-tool-vto-quality-checker', {
    original_person_image_base64: await blobToBase64(personBlob),
    reference_garment_image_base64: await blobToBase64(garmentBlob),
    generated_images_base64: variations.map((img: any) => img.base64Image)
  });
  personBlob = null; garmentBlob = null; // GC
  
  if (!qaData || typeof qaData.best_image_index !== 'number') {
    throw new Error("Quality checker returned invalid data");
  }
  console.log(`${logPrefix} QA complete. Best image index: ${qaData.best_image_index}.`);

  await supabase.from('mira-agent-bitstudio-jobs').update({
    metadata: { ...job.metadata, qa_best_index: qaData.best_image_index, qa_reasoning: qaData.reasoning, google_vto_step: 'compositing' }
  }).eq('id', job.id);

  await safeInvoke(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function handleCompositing(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Compositing best result.`);
  const { bbox, generated_variations, qa_best_index } = job.metadata;
  if (!bbox || !generated_variations || qa_best_index === undefined) throw new Error("Missing data for compositing.");

  const bestVtoPatchBase64 = generated_variations[qa_best_index].base64Image;
  if (!bestVtoPatchBase64) throw new Error("Best VTO patch is missing base64 data.");
  const vtoPatchBuffer = decodeBase64(bestVtoPatchBase64);
  if (vtoPatchBuffer.byteLength === 0) throw new Error("Decoded VTO patch buffer is empty.");
  let vtoPatchImage = await ISImage.decode(vtoPatchBuffer);
  if (!vtoPatchImage) throw new Error("Failed to decode VTO patch image.");

  let personBlob: Blob | null = await safeDownload(supabase, job.source_person_image_url);
  const personImage = await ISImage.decode(await personBlob.arrayBuffer());
  personBlob = null; // GC
  if (!personImage) throw new Error("Failed to decode source person image.");

  let cropAmount = 4;
  cropAmount = Math.min(cropAmount, Math.floor(Math.min(vtoPatchImage.width, vtoPatchImage.height) / 2) - 1);

  if (cropAmount > 0) {
    vtoPatchImage.crop(cropAmount, cropAmount, vtoPatchImage.width - cropAmount * 2, vtoPatchImage.height - cropAmount * 2);
  }

  if (vtoPatchImage.width < 2 || vtoPatchImage.height < 2) {
    throw new Error(`VTO patch too small after crop: ${vtoPatchImage.width}×${vtoPatchImage.height}px`);
  }
  
  const targetWidth = bbox.width - (cropAmount * 2);
  const targetHeight = bbox.height - (cropAmount * 2);

  if (vtoPatchImage.width !== targetWidth || vtoPatchImage.height !== targetHeight) {
      vtoPatchImage.resize(targetWidth, targetHeight);
  }

  const featherWidth = Math.min(20, Math.floor(Math.min(vtoPatchImage.width, vtoPatchImage.height) / 2));
  const mask = new ISImage(vtoPatchImage.width, vtoPatchImage.height);
  for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
          const distToEdge = Math.min(x, mask.width - 1 - x, y, mask.height - 1 - y);
          const alpha = distToEdge < featherWidth ? (distToEdge / featherWidth) * 255 : 255;
          mask.setPixelAt(x, y, ISImage.rgbaToColor(alpha, alpha, alpha, 255));
      }
  }
  vtoPatchImage.mask(mask, true);

  const pasteX = bbox.x + cropAmount;
  const pasteY = bbox.y + cropAmount;

  const finalImage = personImage.clone();
  finalImage.composite(vtoPatchImage, pasteX, pasteY);
  console.log(`${logPrefix} Composition complete.`);

  const finalImageBuffer = await finalImage.encodeJPEG(95);
  if (!finalImageBuffer || finalImageBuffer.length === 0) {
      throw new Error("Failed to encode the final composite image.");
  }
  
  const finalFilePath = `${job.user_id}/vto-packs/${Date.now()}_final_composite.jpeg`;
  await safeUpload(supabase, GENERATED_IMAGES_BUCKET, finalFilePath, finalImageBuffer, { contentType: 'image/jpeg', upsert: true });
  const publicUrl = await safeGetPublicUrl(supabase, GENERATED_IMAGES_BUCKET, finalFilePath);

  await supabase.from('mira-agent-bitstudio-jobs').update({
      status: 'complete',
      final_image_url: publicUrl,
      metadata: { ...job.metadata, google_vto_step: 'done' }
  }).eq('id', job.id);

  console.log(`${logPrefix} Job finished successfully. Final URL: ${publicUrl}`);
}