import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
// --- Global Error Handlers for Observability ---
self.addEventListener("error", (evt)=>{
  console.error("[GLOBAL ERROR]", evt.error);
});
self.addEventListener("unhandledrejection", (evt)=>{
  console.error("[GLOBAL UNHANDLED REJECTION]", evt.reason);
});
// ------------------------------------------------
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TEMP_UPLOAD_BUCKET = 'mira-agent-user-uploads';
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// --- Hardened Safe Wrapper Functions ---
function invokeNextStep(supabase: SupabaseClient, functionName: string, payload: object) {
  // Fire-and-forget: We don't await the result, just handle potential invocation error.
  supabase.functions.invoke(functionName, {
    body: payload
  }).catch((err)=>{
    console.error(`[invokeNextStep] Error invoking ${functionName}:`, err);
  });
}

async function triggerWatchdog(supabase: SupabaseClient, logPrefix: string) {
  console.log(`${logPrefix} Job has terminated. Triggering watchdog to start next job.`);
  for (let i = 0; i < 3; i++) {
    const { error } = await supabase.functions.invoke('MIRA-AGENT-watchdog-background-jobs', { body: {} });
    if (!error) {
      console.log(`${logPrefix} Watchdog invoked successfully.`);
      return;
    }
    console.error(`${logPrefix} Failed to invoke watchdog (attempt ${i+1}/3):`, error.message);
    if (i < 2) await new Promise(resolve => setTimeout(resolve, 1000)); // wait 1s before retry
  }
  console.error(`${logPrefix} CRITICAL: Failed to invoke watchdog after 3 attempts. Next job will start on the next cron schedule.`);
}

async function safeDownload(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const { bucket, path } = parseStorageURL(publicUrl);
    const { data, error } = await supabase.storage.from(bucket).download(path).catch((e)=>{
        throw e ?? new Error(`[safeDownload:${path}] rejected with null`);
    });
    if (error) throw error ?? new Error(`[safeDownload:${path}] error was null`);
    if (!data) throw new Error(`[safeDownload:${path}] data missing`);
    return data;
}
async function safeUpload(supabase: SupabaseClient, bucket: string, path: string, body: any, options: any) {
  const { error } = await supabase.storage.from(bucket).upload(path, body, options).catch((e)=>{
    throw e ?? new Error(`[safeUpload:${path}] rejected with null`);
  });
  if (error) throw error ?? new Error(`[safeUpload:${path}] error was null`);
}
async function safeGetPublicUrl(supabase: SupabaseClient, bucket: string, path: string): Promise<string> {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data || !data.publicUrl) throw new Error(`[safeGetPublicUrl:${path}] Failed to create public URL.`);
  return data.publicUrl;
}
async function uploadBase64ToStorage(supabase: SupabaseClient, base64: string, userId: string, filename: string) {
    const buffer = decodeBase64(base64);
    const filePath = `${userId}/vto-pack-results/${Date.now()}-${filename}`;
    await safeUpload(supabase, GENERATED_IMAGES_BUCKET, filePath, new Blob([
        buffer
    ], {
        type: 'image/png'
    }), {
        contentType: 'image/png',
        upsert: true
    });
    const publicUrl = await safeGetPublicUrl(supabase, GENERATED_IMAGES_BUCKET, filePath);
    return {
        publicUrl,
        storagePath: filePath
    };
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
  return {
    bucket,
    path
  };
}
const blobToBase64 = async (blob: Blob): Promise<string>=>{
  const buffer = await blob.arrayBuffer();
  return encodeBase64(new Uint8Array(buffer)); // Use Uint8Array for safety
};
// --- State Machine Logic ---
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const { pair_job_id, reframe_result_url, bitstudio_result_url } = await req.json();
  if (!pair_job_id) {
    return new Response(JSON.stringify({
      error: "pair_job_id is required."
    }), {
      status: 400,
      headers: corsHeaders
    });
  }
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-Pack-Worker][${pair_job_id}]`;
  let job;
  try {
    const { data: fetchedJob, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', pair_job_id).single();
    if (fetchError) throw fetchError;
    job = fetchedJob;
    if (reframe_result_url) {
      console.log(`${logPrefix} Received reframe result. Finalizing job.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'complete',
        final_image_url: reframe_result_url
      }).eq('id', pair_job_id);
      console.log(`${logPrefix} Job successfully finalized.`);
      await triggerWatchdog(supabase, logPrefix);
    } else if (bitstudio_result_url) {
        console.log(`${logPrefix} Received BitStudio fallback result. Running final quality check.`);
        await handleQualityCheck(supabase, job, logPrefix, bitstudio_result_url);
    } else {
      console.log(`${logPrefix} Starting job.`);
      const step = job.metadata?.google_vto_step || 'start';
      console.log(`${logPrefix} Current step: ${step}`);
      switch(step){
        case 'start':
          await handleStart(supabase, job, logPrefix);
          break;
        case 'generate_step_1':
          await handleGenerateStep(supabase, job, 15, 'quality_check', logPrefix);
          break;
        case 'generate_step_2':
          await handleGenerateStep(supabase, job, 30, 'quality_check', logPrefix);
          break;
        case 'generate_step_3':
          await handleGenerateStep(supabase, job, 55, 'quality_check', logPrefix);
          break;
        case 'quality_check':
          await handleQualityCheck(supabase, job, logPrefix);
          break;
        case 'reframe':
          await handleReframe(supabase, job, logPrefix);
          break;
        case 'done':
        case 'fallback_to_bitstudio':
          console.log(`${logPrefix} Job is already in a terminal state ('${step}'). Exiting gracefully.`);
          break;
        default:
          throw new Error(`Unknown step: ${step}`);
      }
    }
    return new Response(JSON.stringify({
      success: true,
      message: "Step initiated."
    }), {
      headers: corsHeaders
    });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({
      status: 'failed',
      error_message: error.message
    }).eq('id', pair_job_id);
    await triggerWatchdog(supabase, logPrefix); // Trigger watchdog even on failure to free up the slot
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
async function handleStart(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Step 1: Getting bounding box and optimizing images.`);
  const { data: bboxData, error: bboxError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-bbox', {
    body: {
      image_url: job.source_person_image_url
    }
  });
  if (bboxError) throw bboxError;
  const personBox = bboxData?.person;
  if (!personBox || !Array.isArray(personBox) || personBox.length !== 4 || personBox.some((v: any)=>typeof v !== 'number')) {
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
  const abs_x = Math.floor(personBox[1] / 1000 * originalWidth);
  const abs_y = Math.floor(personBox[0] / 1000 * originalHeight);
  const abs_width = Math.ceil((personBox[3] - personBox[1]) / 1000 * originalWidth);
  const abs_height = Math.ceil((personBox[2] - personBox[0]) / 1000 * originalHeight);
  const bbox = {
    x: Math.max(0, Math.min(abs_x, originalWidth - 1)),
    y: Math.max(0, Math.min(abs_y, originalHeight - 1)),
    width: Math.max(1, Math.min(abs_width, originalWidth - abs_x)),
    height: Math.max(1, Math.min(abs_height, originalHeight - abs_y))
  };
  const croppedPersonImage = personImage.clone().crop(bbox.x, bbox.y, bbox.width, bbox.height);
  const croppedPersonBuffer = await croppedPersonImage.encodeJPEG(75);
  console.log(`${logPrefix} Cropped person JPEG buffer size: ${croppedPersonBuffer.length} bytes.`);
  const croppedPersonBlob = new Blob([
    croppedPersonBuffer
  ], {
    type: 'image/jpeg'
  });
  const tempPersonPath = `tmp/${job.user_id}/${Date.now()}-cropped_person.jpeg`;
  await safeUpload(supabase, TEMP_UPLOAD_BUCKET, tempPersonPath, croppedPersonBlob, {
    contentType: "image/jpeg"
  });
  const croppedPersonUrl = await safeGetPublicUrl(supabase, TEMP_UPLOAD_BUCKET, tempPersonPath);
  console.log(`${logPrefix} Cropped person image uploaded to temp storage.`);
  const garmentImage = await ISImage.decode(await garmentBlob.arrayBuffer());
  garmentBlob = null; // GC
  const MAX_GARMENT_DIMENSION = 2048;
  if (Math.max(garmentImage.width, garmentImage.height) > MAX_GARMENT_DIMENSION) {
    garmentImage.resize(garmentImage.width > garmentImage.height ? MAX_GARMENT_DIMENSION : ISImage.RESIZE_AUTO, garmentImage.height > garmentImage.width ? MAX_GARMENT_DIMENSION : ISImage.RESIZE_AUTO);
  }
  const optimizedGarmentBuffer = await garmentImage.encodeJPEG(75);
  console.log(`${logPrefix} Optimized garment JPEG buffer size: ${optimizedGarmentBuffer.length} bytes.`);
  const optimizedGarmentBlob = new Blob([
    optimizedGarmentBuffer
  ], {
    type: 'image/jpeg'
  });
  const tempGarmentPath = `tmp/${job.user_id}/${Date.now()}-optimized_garment.jpeg`;
  await safeUpload(supabase, TEMP_UPLOAD_BUCKET, tempGarmentPath, optimizedGarmentBlob, {
    contentType: "image/jpeg"
  });
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
  invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
    pair_job_id: job.id
  });
}
async function handleGenerateStep(supabase: SupabaseClient, job: any, sampleStep: number, nextStep: string, logPrefix: string) {
  console.log(`${logPrefix} Generating variation with ${sampleStep} steps.`);
  const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
    body: {
      person_image_url: job.metadata.cropped_person_url,
      garment_image_url: job.metadata.optimized_garment_url,
      sample_count: 3, // Always generate 3 images per pass
      sample_step: sampleStep
    }
  });
  if (error) throw error;
  const generatedImages = data?.generatedImages;
  if (!generatedImages || !Array.isArray(generatedImages) || generatedImages.length === 0 || !generatedImages[0]?.base64Image) {
    throw new Error(`VTO tool did not return a valid image for step ${sampleStep}`);
  }
  const currentVariations = job.metadata.generated_variations || [];
  await supabase.from('mira-agent-bitstudio-jobs').update({
    metadata: {
      ...job.metadata,
      generated_variations: [
        ...currentVariations,
        ...generatedImages // Add all new images
      ],
      google_vto_step: nextStep
    }
  }).eq('id', job.id);
  console.log(`${logPrefix} Step ${sampleStep} complete. Advancing to ${nextStep}.`);
  invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
    pair_job_id: job.id
  });
}
async function handleQualityCheck(supabase: SupabaseClient, job: any, logPrefix: string, bitstudio_result_url?: string) {
  console.log(`${logPrefix} Performing quality check.`);
  const { metadata, id: pair_job_id } = job;
  const variations = metadata.generated_variations || [];
  const qa_retry_count = metadata.qa_retry_count || 0;
  let is_final_attempt = qa_retry_count >= 2;

  if (bitstudio_result_url) {
      console.log(`${logPrefix} BitStudio fallback result provided. This is the absolute final attempt.`);
      is_final_attempt = true;
      const bitstudioBlob = await safeDownload(supabase, bitstudio_result_url);
      variations.push({ base64Image: await blobToBase64(bitstudioBlob) });
  }

  if (!variations || !Array.isArray(variations) || variations.length === 0) {
    throw new Error("No variations generated for quality check.");
  }

  let [personBlob, garmentBlob] = await Promise.all([
    safeDownload(supabase, job.source_person_image_url),
    safeDownload(supabase, job.source_garment_image_url)
  ]);

  const { data: qaData, error } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-quality-checker', {
    body: {
      original_person_image_base64: await blobToBase64(personBlob),
      reference_garment_image_base64: await blobToBase64(garmentBlob),
      generated_images_base64: variations.map((img: any) => img.base64Image),
      is_final_attempt: is_final_attempt,
      is_absolute_final_attempt: !!bitstudio_result_url,
    }
  });

  personBlob = null; // GC
  garmentBlob = null; // GC

  if (error) throw error;
  if (!qaData || !qaData.action) {
    throw new Error("Quality checker returned invalid data");
  }

  console.log(`[VTO_QA_DECISION][${pair_job_id}] Full AI Response:`, JSON.stringify(qaData, null, 2));

  const qa_history = metadata.qa_history || [];
  const newHistoryEntry = {
    pass_number: qa_retry_count + 1,
    ...qaData
  };
  qa_history.push(newHistoryEntry);

  if (qaData.action === 'retry') {
    if (is_final_attempt) {
        console.warn(`[BITSTUDIO_FALLBACK][${pair_job_id}] QA failed on final Google attempt. Escalating to BitStudio. Using cropped person URL: ${job.metadata.cropped_person_url}`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: { ...metadata, qa_history: qa_history, google_vto_step: 'fallback_to_bitstudio' }
        }).eq('id', pair_job_id);
        
        const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
            body: {
                existing_job_id: pair_job_id,
                mode: 'base',
                user_id: job.user_id,
                person_image_url: job.metadata.cropped_person_url,
                garment_image_url: job.source_garment_image_url,
                prompt: metadata.prompt_appendix,
                num_images: 1,
                resolution: 'high'
            }
        });
        if (proxyError) throw proxyError;
        console.log(`${logPrefix} BitStudio fallback job created with ID ${proxyData.jobIds[0]}. The BitStudio poller will now take over.`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'awaiting_bitstudio_fallback',
            metadata: { ...metadata, delegated_bitstudio_job_id: proxyData.jobIds[0] }
        }).eq('id', pair_job_id);
        await triggerWatchdog(supabase, logPrefix);
    } else {
        console.log(`${logPrefix} QA requested a retry. Incrementing retry count and starting next generation pass.`);
        const nextStep = `generate_step_${qa_retry_count + 2}`;
        await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: {
                ...metadata,
                qa_history: qa_history,
                qa_retry_count: qa_retry_count + 1,
                google_vto_step: nextStep
            }
        }).eq('id', pair_job_id);
        invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id });
    }
  } else { // action === 'select'
    console.log(`${logPrefix} QA selected an image. Proceeding to finalize.`);
    const bestImageBase64 = variations[qaData.best_image_index].base64Image;
    const shouldSkipReframe = metadata.skip_reframe === true || metadata.final_aspect_ratio === '1:1';

    if (shouldSkipReframe) {
      console.log(`${logPrefix} Reframe is skipped. Finalizing job.`);
      const finalImage = await uploadBase64ToStorage(supabase, bestImageBase64, job.user_id, 'final_vto_pack.png');
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'complete',
        final_image_url: finalImage.publicUrl,
        metadata: {
          ...metadata,
          qa_history: qa_history,
          qa_best_image_base64: null, // Clear large data
          google_vto_step: 'done'
        }
      }).eq('id', pair_job_id);
      console.log(`${logPrefix} Job finalized with 1:1 image.`);
      await triggerWatchdog(supabase, logPrefix);
    } else {
      await supabase.from('mira-agent-bitstudio-jobs').update({
        metadata: {
          ...metadata,
          qa_history: qa_history,
          qa_best_image_base64: bestImageBase64,
          google_vto_step: 'reframe'
        }
      }).eq('id', pair_job_id);
      invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id });
    }
  }
}
async function handleReframe(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Final step: Reframe.`);
  const { qa_best_image_base64, final_aspect_ratio, prompt_appendix } = job.metadata;
  if (!qa_best_image_base64 || !final_aspect_ratio) {
    throw new Error("Missing best VTO image or final aspect ratio for reframe step.");
  }
  const { data: reframeJobData, error: reframeError } = await supabase.functions.invoke('MIRA-AGENT-proxy-reframe', {
    body: {
      user_id: job.user_id,
      base_image_base64: qa_best_image_base64,
      prompt: prompt_appendix || "",
      aspect_ratio: final_aspect_ratio,
      source: 'reframe_from_vto',
      parent_vto_job_id: job.id
    }
  });
  if (reframeError) throw reframeError;
  await supabase.from('mira-agent-bitstudio-jobs').update({
    status: 'awaiting_reframe',
    metadata: {
      ...job.metadata,
      google_vto_step: 'done',
      delegated_reframe_job_id: reframeJobData.jobId,
      qa_best_image_base64: null
    }
  }).eq('id', job.id);
  console.log(`${logPrefix} Handed off to reframe job ${reframeJobData.jobId}. This VTO job is now awaiting the final result.`);
}