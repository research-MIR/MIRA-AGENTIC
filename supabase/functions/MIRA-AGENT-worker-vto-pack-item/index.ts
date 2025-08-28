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
const ENABLE_BITSTUDIO_FALLBACK = false; // FEATURE FLAG
const FAIL_ON_OUTFIT_ANALYSIS_ERROR = true; // FEATURE FLAG: If true, job fails on analysis error. If false, it skips and proceeds.
const OUTFIT_ANALYSIS_MAX_RETRIES = 3;
const OUTFIT_ANALYSIS_RETRY_DELAY_MS = 15000; // Increased delay
const REFRAME_STALL_THRESHOLD_SECONDS = 180; // Increased to 3 minutes
const MAX_REFRAME_RETRIES = 2;
const QA_MAX_RETRIES = 3;
const MAX_DB_RETRIES = 5; // New constant for database connection retries

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

// --- Hardened Safe Wrapper Functions ---
async function invokeNextStep(supabase: SupabaseClient, functionName: string, payload: object) {
  const { error } = await supabase.functions.invoke(functionName, {
    body: payload
  });
  if (error) {
    console.error(`[invokeNextStep] Error invoking ${functionName}:`, error);
    throw error;
  }
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

async function safeDownload(supabase: SupabaseClient, publicUrl: string, logPrefix: string) {
  console.log(`${logPrefix} [safeDownload] Starting download for: ${publicUrl}`);
  const { bucket, path } = parseStorageURL(publicUrl);
  console.log(`${logPrefix} [safeDownload] Parsed URL. Bucket: ${bucket}, Path: ${path}`);
  const { data, error } = await supabase.storage.from(bucket).download(path).catch((e: any) => { throw e ?? new Error(`[safeDownload:${path}] rejected with null`) });
  if (error) throw error ?? new Error(`[safeDownload:${path}] error was null`);
  if (!data) throw new Error(`[safeDownload:${path}] data missing`);
  console.log(`${logPrefix} [safeDownload] Download successful. Blob size: ${data.size}`);
  return data;
}

async function safeUpload(supabase: SupabaseClient, bucket: string, path: string, body: any, options: any) {
  const { error } = await supabase.storage.from(bucket).upload(path, body, options).catch((e: any) => { throw e ?? new Error(`[safeUpload:${path}] rejected with null`) });
  if (error) throw error ?? new Error(`[safeUpload:${path}] error was null`);
}

async function safeGetPublicUrl(supabase: SupabaseClient, bucket: string, path: string) {
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data || !data.publicUrl) throw new Error(`[safeGetPublicUrl:${path}] Failed to create public URL.`);
  return data.publicUrl;
}

async function uploadBase64ToStorage(supabase: SupabaseClient, base64: string, userId: string, filename: string) {
    const buffer = decodeBase64(base64);
    const filePath = `${userId}/vto-pack-results/${Date.now()}-${filename}`;
    await safeUpload(supabase, GENERATED_IMAGES_BUCKET, filePath, new Blob([buffer], { type: 'image/png' }), { contentType: 'image/png', upsert: true });
    const publicUrl = await safeGetPublicUrl(supabase, GENERATED_IMAGES_BUCKET, filePath);
    return { publicUrl, storagePath: filePath };
}

// --- Utility Functions ---
const blobToBase64 = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  return encodeBase64(new Uint8Array(buffer));
};

function safeStringify(obj: any, limit = 8000): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > limit ? s.slice(0, limit) + `… [truncated ${s.length - limit} chars]` : s;
  } catch {
    return '[unstringifiable JSON]';
  }
}

function buildRenderImageUrl(publicUrl: string, params?: { format?: 'webp' | 'jpg', quality?: number }) {
  const u = new URL(publicUrl);
  u.pathname = u.pathname.replace('/object/', '/render/image/');
  if (params?.format) u.searchParams.set('format', params.format);
  if (typeof params?.quality === 'number') u.searchParams.set('quality', String(params.quality));
  return u.toString();
}

async function safeDownloadOptimized(publicUrl: string, logPrefix: string, params = { format: 'webp' as const, quality: 82 }) {
  if (publicUrl.includes('/sign/')) {
    throw new Error("Cannot use render endpoint with signed URLs.");
  }
  const renderUrl = buildRenderImageUrl(publicUrl, params);
  try {
    const res = await fetch(renderUrl);
    if (!res.ok) throw new Error(`render fetch failed: ${res.status} ${res.statusText}`);
    const blob = await res.blob();
    console.log(`${logPrefix} [safeDownloadOptimized] Transformed download. Blob size: ${blob.size}`);
    return blob;
  } catch (e) {
    console.warn(`${logPrefix} [safeDownloadOptimized] Falling back to direct download: ${String(e)}`);
    throw e;
  }
}

async function toJpegBase64(blob: Blob, quality = 82) {
  const arr = await blob.arrayBuffer();
  let img: ISImage | null = await ISImage.decode(arr);
  const buf = await img.encodeJPEG(quality);
  // @ts-ignore
  img = null;
  return encodeBase64(new Uint8Array(buf));
}

async function invokeWithRetry(supabase: SupabaseClient, functionName: string, payload: object, maxRetries: number, logPrefix: string) {
  let lastError: Error | null = null;
  for(let attempt = 1; attempt <= maxRetries; attempt++){
    try {
      const { data, error } = await supabase.functions.invoke(functionName, payload);
      if (error) {
        throw new Error(error.message || 'Function invocation failed with an unknown error.');
      }
      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`${logPrefix} Invocation of '${functionName}' failed on attempt ${attempt}/${maxRetries}. Error: ${lastError.message}`);
      if (attempt < maxRetries) {
        const delay = 15000 * Math.pow(2, attempt - 1); // Exponential backoff: 15s, 30s, 60s...
        console.warn(`${logPrefix} Waiting ${delay}ms before retrying...`);
        await new Promise((resolve)=>setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || new Error("Function failed after all retries without a specific error.");
}

async function generateMixedPortfolio(supabase: SupabaseClient, job: any, steps: any[], logPrefix: string) {
  try {
    console.log(`${logPrefix} Verifying dimensions of garment image before generation...`);
    const garmentBlob = await safeDownload(supabase, job.metadata.optimized_garment_url, logPrefix);
    const arr = await garmentBlob.arrayBuffer();
    let garmentImage: ISImage | null = await ISImage.decode(arr);
    console.log(`${logPrefix} VERIFIED: Garment image dimensions sent to VTO tool are ${garmentImage.width}x${garmentImage.height}.`);
    garmentImage = null;
    await Promise.resolve();  // yield to GC
  } catch (e) {
    console.warn(`${logPrefix} Could not verify garment image dimensions before generation. This is non-fatal. Error: ${e.message}`);
  }

  // Run each step sequentially to lower peak memory.
  const allImages: any[] = [];
  for (const stepConfig of steps) {
    const data = await invokeWithRetry(
      supabase,
      'MIRA-AGENT-tool-virtual-try-on',
      { body: { ...stepConfig, person_image_url: job.metadata.cropped_person_url, garment_image_url: job.metadata.optimized_garment_url } },
      3,
      logPrefix
    );
    const images = data?.generatedImages || [];
    if (images.length === 0) throw new Error("VTO tool did not return any valid images for this generation step.");
    for (const img of images) allImages.push(img);

    // Give GC a scheduling point before next heavy call
    await Promise.resolve();
  }
  return allImages;
}

async function createPaddedSquareImage(image: ISImage, logPrefix: string): Promise<ISImage> {
  const w = image.width, h = image.height;
  if (w === h) {
    console.log(`${logPrefix} [createPaddedSquareImage] Already 1:1; skipping canvas allocation.`);
    return image;
  }
  console.log(`${logPrefix} [createPaddedSquareImage] Applying 1:1 squaring with zero padding.`);
  const size = Math.max(w, h);
  const canvas = new ISImage(size, size).fill(0xFFFFFFFF);
  const dx = Math.round((size - w) / 2), dy = Math.round((size - h) / 2);
  canvas.composite(image, dx, dy);
  // @ts-ignore
  image = null; // let GC reclaim the original bitmap
  console.log(`${logPrefix} [createPaddedSquareImage] Transformed from ${w}x${h} to ${size}x${size} canvas.`);
  return canvas;
}

// --- State Machine Logic ---
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  const { pair_job_id, reframe_result_url, bitstudio_result_url, retry_attempt = 0 } = await req.json();
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
  let job: any;
  try {
    const { data: fetchedJob, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', pair_job_id).single();
    if (fetchError) throw fetchError;
    job = fetchedJob;
    const terminalStatuses = [
      'complete',
      'failed',
      'permanently_failed'
    ];
    const isTerminalStep = job.metadata?.google_vto_step === 'done';
    if (terminalStatuses.includes(job.status) || isTerminalStep) {
      console.log(`${logPrefix} Job is in a terminal or hands-off state ('${job.status}', step: '${job.metadata?.google_vto_step}'). Exiting gracefully.`);
      return new Response(JSON.stringify({
        success: true,
        message: "Job already in a terminal state."
      }), {
        headers: corsHeaders
      });
    }
    if (reframe_result_url) {
      console.log(`${logPrefix} Received reframe result. Finalizing job.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'complete',
        final_image_url: reframe_result_url,
        metadata: {
          ...job.metadata,
          google_vto_step: 'done'
        }
      }).eq('id', pair_job_id);
      console.log(`${logPrefix} Job successfully finalized.`);
    } else if (bitstudio_result_url) {
      console.log(`${logPrefix} Received BitStudio fallback result. Running final quality check.`);
      await handleQualityCheck(supabase, job, logPrefix, bitstudio_result_url);
    } else {
      console.log(`${logPrefix} Starting job.`);
      const step = job.metadata?.google_vto_step || 'start';
      console.log(`${logPrefix} Current step: ${step}`);
      switch(step){
        case 'start':
          await handleStart_GetBbox(supabase, job, logPrefix);
          break;
        case 'prepare_assets':
          await handlePrepareAssets(supabase, job, logPrefix);
          break;
        case 'generate_step_1':
          {
            console.log(`${logPrefix} Generating Round 1 portfolio (2x30, 2x50 steps).`);
            const generatedImages = await generateMixedPortfolio(supabase, job, [
              {
                sample_step: 30,
                sample_count: 2
              },
              {
                sample_step: 50,
                sample_count: 2
              }
            ], logPrefix);
            await supabase.from('mira-agent-bitstudio-jobs').update({
              metadata: {
                ...job.metadata,
                generated_variations: generatedImages,
                google_vto_step: 'quality_check'
              },
              status: 'quality_check'
            }).eq('id', job.id);
            console.log(`${logPrefix} Round 1 complete. Advancing to quality_check.`);
            await Promise.resolve(); // Yield to GC
            await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
              pair_job_id: job.id
            });
            break;
          }
        case 'generate_step_2':
          {
            console.log(`${logPrefix} Generating Round 2 portfolio (2x50, 2x80 steps).`);
            const newImages = await generateMixedPortfolio(supabase, job, [
              {
                sample_step: 50,
                sample_count: 2
              },
              {
                sample_step: 80,
                sample_count: 2
              }
            ], logPrefix);
            const currentVariations = job.metadata.generated_variations || [];
            await supabase.from('mira-agent-bitstudio-jobs').update({
              metadata: {
                ...job.metadata,
                generated_variations: [
                  ...currentVariations,
                  ...newImages
                ],
                google_vto_step: 'quality_check'
              },
              status: 'quality_check'
            }).eq('id', job.id);
            console.log(`${logPrefix} Round 2 complete. Advancing to quality_check.`);
            await Promise.resolve(); // Yield to GC
            await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
              pair_job_id: job.id
            });
            break;
          }
        case 'generate_step_3':
          {
            console.log(`${logPrefix} Generating Round 3 portfolio (2x80 steps).`);
            const newImages = await generateMixedPortfolio(supabase, job, [
              {
                sample_step: 80,
                sample_count: 2
              }
            ], logPrefix);
            const currentVariations = job.metadata.generated_variations || [];
            await supabase.from('mira-agent-bitstudio-jobs').update({
              metadata: {
                ...job.metadata,
                generated_variations: [
                  ...currentVariations,
                  ...newImages
                ],
                google_vto_step: 'quality_check'
              },
              status: 'quality_check'
            }).eq('id', job.id);
            console.log(`${logPrefix} Round 3 complete. Advancing to final quality_check.`);
            await Promise.resolve(); // Yield to GC
            await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
              pair_job_id: job.id
            });
            break;
          }
        case 'quality_check':
          await handleQualityCheck(supabase, job, logPrefix);
          break;
        case 'outfit_completeness_check':
          await handleOutfitCompletenessCheck(supabase, job, logPrefix);
          break;
        case 'awaiting_auto_complete':
          await handleAutoComplete(supabase, job, logPrefix);
          break;
        case 'reframe':
          await handleReframe(supabase, job, logPrefix);
          break;
        case 'awaiting_reframe':
          await handleAwaitingReframe(supabase, job, logPrefix);
          break;
        case 'done':
        case 'fallback_to_bitstudio':
        case 'awaiting_stylist_choice':
          console.log(`${logPrefix} Job is in a waiting or terminal state ('${step}'). Exiting gracefully.`);
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix} Error:`, errorMessage);
    const isInfrastructureError = errorMessage.includes("Could not query the database for the schema cache") || errorMessage.includes("Edge Function returned a non-2xx status code");
    if (isInfrastructureError && retry_attempt < MAX_DB_RETRIES) {
      const nextAttempt = retry_attempt + 1;
      const delay = 10000 * Math.pow(2, retry_attempt); // 10s, 20s, 40s...
      console.warn(`${logPrefix} Infrastructure error detected. Retrying in ${delay}ms (Attempt ${nextAttempt}/${MAX_DB_RETRIES}).`);
      await new Promise((resolve)=>setTimeout(resolve, delay));
      await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
        pair_job_id,
        reframe_result_url,
        bitstudio_result_url,
        retry_attempt: nextAttempt
      });
      return new Response(JSON.stringify({
        success: true,
        message: `Recovery attempt ${nextAttempt} initiated.`
      }), {
        headers: corsHeaders
      });
    }
    const currentStep = job?.metadata?.google_vto_step;
    if (job && (currentStep?.startsWith('generate_step') || currentStep?.startsWith('quality_check')) && ENABLE_BITSTUDIO_FALLBACK) {
      console.warn(`[BITSTUDIO_FALLBACK][${job.id}] A Google VTO generation or quality check step failed. Escalating to BitStudio. Triggering reason: ${errorMessage}`);
      try {
        await supabase.from('mira-agent-bitstudio-jobs').update({
          metadata: {
            ...job.metadata,
            google_vto_step: 'fallback_to_bitstudio',
            engine: 'bitstudio_fallback'
          }
        }).eq('id', pair_job_id);
        const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
          body: {
            existing_job_id: pair_job_id,
            mode: 'base',
            user_id: job.user_id,
            person_image_url: job.source_person_image_url,
            garment_image_url: job.source_garment_image_url,
            prompt: job.metadata.prompt_appendix,
            num_images: 1,
            resolution: 'high'
          }
        });
        if (proxyError) throw new Error(proxyError.message || 'Proxy invocation failed.');
        console.log(`${logPrefix} BitStudio fallback job created with ID ${proxyData.jobIds[0]}. The BitStudio poller will now take over.`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
          status: 'awaiting_bitstudio_fallback',
          metadata: {
            ...job.metadata,
            delegated_bitstudio_job_id: proxyData.jobIds[0]
          }
        }).eq('id', pair_job_id);
        return new Response(JSON.stringify({
          success: true,
          message: "Escalated to BitStudio fallback."
        }), {
          headers: corsHeaders
        });
      } catch (fallbackError) {
        const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error(`${logPrefix} CRITICAL: BitStudio fallback attempt also failed:`, fallbackErrorMessage);
        await supabase.from('mira-agent-bitstudio-jobs').update({
          status: 'failed',
          error_message: `Google VTO failed and BitStudio fallback also failed: ${fallbackErrorMessage}`
        }).eq('id', pair_job_id);
        return new Response(JSON.stringify({
          error: fallbackErrorMessage
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          },
          status: 500
        });
      }
    } else {
      if (job && (currentStep?.startsWith('generate_step') || currentStep?.startsWith('quality_check'))) {
        console.warn(`[BITSTUDIO_FALLBACK][${job.id}] Fallback is disabled. Job will fail.`);
      }
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'failed',
        error_message: errorMessage
      }).eq('id', pair_job_id);
      return new Response(JSON.stringify({
        error: errorMessage
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        },
        status: 500
      });
    }
  }
});

async function handleStart_GetBbox(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Step 1: Getting bounding box.`);
  await supabase.from('mira-agent-bitstudio-jobs').update({
    status: 'processing'
  }).eq('id', job.id);
  const { data: bboxData, error: bboxError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-bbox', {
    body: {
      image_url: job.source_person_image_url,
      job_id: job.id
    }
  });
  if (bboxError) throw new Error(bboxError.message || 'BBox orchestrator failed.');
  const personBox = bboxData?.person;
  if (!personBox || !Array.isArray(personBox) || personBox.length !== 4 || personBox.some((v: any)=>typeof v !== 'number')) {
    throw new Error("Orchestrator did not return a valid bounding box array.");
  }
  console.log(`${logPrefix} Bounding box received.`);
  await supabase.from('mira-agent-bitstudio-jobs').update({
    metadata: {
      ...job.metadata,
      bbox_person: personBox,
      google_vto_step: 'prepare_assets'
    },
    status: 'prepare_assets'
  }).eq('id', job.id);
  console.log(`${logPrefix} Bounding box saved. Advancing to 'prepare_assets'.`);
  await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
    pair_job_id: job.id
  });
}

async function handlePrepareAssets(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Step 2: Preparing and optimizing image assets.`);
  await supabase.from('mira-agent-bitstudio-jobs').update({
    status: 'prepare_assets'
  }).eq('id', job.id);
  const { source_person_image_url, source_garment_image_url, metadata } = job;
  const personBox = metadata.bbox_person;
  if (!personBox) throw new Error("Cannot prepare assets: bbox_person is missing from metadata.");
  
  let [personBlob, garmentBlob] = await Promise.all([
    safeDownload(supabase, source_person_image_url, logPrefix),
    safeDownload(supabase, source_garment_image_url, logPrefix)
  ]);
  console.log(`${logPrefix} Original blob sizes - Person: ${personBlob.size} bytes, Garment: ${garmentBlob.size} bytes.`);

  let croppedPersonUrl: string;
  let optimizedGarmentUrl: string;

  { // PERSON SCOPE
    const personArr = await personBlob.arrayBuffer();
    personBlob = null;
    let personImage: ISImage | null = await ISImage.decode(personArr);
    // @ts-ignore
    let arr: any = personArr;
    arr = null;

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
    
    personImage.crop(bbox.x, bbox.y, bbox.width, bbox.height);
    const croppedPersonBuffer = await personImage.encodeJPEG(75);
    // @ts-ignore
    personImage = null;

    const croppedPersonBlob = new Blob([croppedPersonBuffer], { type: 'image/jpeg' });
    const tempPersonPath = `tmp/${job.user_id}/${Date.now()}-cropped_person.jpeg`;
    await safeUpload(supabase, TEMP_UPLOAD_BUCKET, tempPersonPath, croppedPersonBlob, { contentType: "image/jpeg" });
    croppedPersonUrl = await safeGetPublicUrl(supabase, TEMP_UPLOAD_BUCKET, tempPersonPath);
    console.log(`${logPrefix} Cropped person image uploaded to temp storage.`);
    await Promise.resolve(); // Yield to GC
  }

  { // GARMENT SCOPE
    const garmentArr = await garmentBlob.arrayBuffer();
    garmentBlob = null;
    let garmentImage: ISImage | null = await ISImage.decode(garmentArr);
    // @ts-ignore
    let arr: any = garmentArr;
    arr = null;

    const MAX_GARMENT_DIMENSION = 2048;
    if (Math.max(garmentImage.width, garmentImage.height) > MAX_GARMENT_DIMENSION) {
      garmentImage.resize(
        garmentImage.width > garmentImage.height ? MAX_GARMENT_DIMENSION : ISImage.RESIZE_AUTO,
        garmentImage.height > garmentImage.width ? MAX_GARMENT_DIMENSION : ISImage.RESIZE_AUTO
      );
    }
    let finalGarmentImage = await createPaddedSquareImage(garmentImage, logPrefix);
    // @ts-ignore
    garmentImage = null;

    const optimizedGarmentBuffer = await finalGarmentImage.encodeJPEG(75);
    // @ts-ignore
    finalGarmentImage = null;

    const optimizedGarmentBlob = new Blob([optimizedGarmentBuffer], { type: 'image/jpeg' });
    const tempGarmentPath = `tmp/${job.user_id}/${Date.now()}-optimized_garment.jpeg`;
    await safeUpload(supabase, TEMP_UPLOAD_BUCKET, tempGarmentPath, optimizedGarmentBlob, { contentType: "image/jpeg" });
    optimizedGarmentUrl = await safeGetPublicUrl(supabase, TEMP_UPLOAD_BUCKET, tempGarmentPath);
    console.log(`${logPrefix} Optimized, padded, and squared garment image uploaded to temp storage.`);
  }

  console.log(`${logPrefix} Saved processed garment URL to metadata.debug_assets: ${optimizedGarmentUrl}`);
  await supabase.from('mira-agent-bitstudio-jobs').update({
    metadata: {
      ...metadata,
      bbox: metadata.bbox_person, // Keep original bbox for potential future use
      cropped_person_url: croppedPersonUrl,
      optimized_garment_url: optimizedGarmentUrl,
      debug_assets: {
        ...metadata.debug_assets || {},
        processed_garment_url: optimizedGarmentUrl
      },
      google_vto_step: 'generate_step_1'
    },
    status: 'generate_step_1'
  }).eq('id', job.id);
  console.log(`${logPrefix} All assets prepared. Advancing to 'generate_step_1'.`);
  await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
    pair_job_id: job.id
  });
}

async function handleQualityCheck(supabase: SupabaseClient, job: any, logPrefix: string, bitstudio_result_url?: string) {
  await supabase.from('mira-agent-bitstudio-jobs').update({
    status: `quality_check_${(job.metadata.qa_retry_count || 0) + 1}`
  }).eq('id', job.id);
  console.log(`${logPrefix} Performing quality check.`);
  const { metadata, id: pair_job_id } = job;
  const variations = metadata.generated_variations || [];
  const qa_retry_count = metadata.qa_retry_count || 0;
  let is_escalation_check = qa_retry_count >= 2;
  if (bitstudio_result_url) {
    console.log(`${logPrefix} BitStudio fallback result provided. This is the absolute final attempt.`);
    is_escalation_check = true;
    const bitstudioBlob = await safeDownload(supabase, bitstudio_result_url, logPrefix);
    variations.push({
      base64Image: await blobToBase64(bitstudioBlob)
    });
  }
  if (!variations || !Array.isArray(variations) || variations.length === 0) {
    throw new Error("No variations generated for quality check.");
  }
  let qaData;
  let lastQaError = null;
  for(let attempt = 1; attempt <= QA_MAX_RETRIES; attempt++){
    let personBlob: Blob | null = null, garmentBlob: Blob | null = null;
    try {
      const personUrlForQa  = job.metadata.cropped_person_url   || job.source_person_image_url;
      const garmentUrlForQa = job.metadata.optimized_garment_url || job.source_garment_image_url;

      try {
        [personBlob, garmentBlob] = await Promise.all([
          safeDownloadOptimized(personUrlForQa, logPrefix, { format: 'webp', quality: 82 }),
          safeDownloadOptimized(garmentUrlForQa, logPrefix, { format: 'webp', quality: 82 })
        ]);
      } catch {
        [personBlob, garmentBlob] = await Promise.all([
          safeDownload(supabase, personUrlForQa, logPrefix),
          safeDownload(supabase, garmentUrlForQa, logPrefix)
        ]);
      }

      const personB64  = await toJpegBase64(personBlob, 82);
      const garmentB64 = await toJpegBase64(garmentBlob, 82);

      const { data, error: analysisError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-quality-checker', {
        body: {
          original_person_image_base64: personB64,
          reference_garment_image_base64: garmentB64,
          generated_images_base64: variations.map((img: any)=>img.base64Image),
          is_escalation_check: is_escalation_check,
          is_absolute_final_attempt: !!bitstudio_result_url
        }
      });
      if (analysisError) throw analysisError;
      if (data.error) {
        throw new Error(`QA tool reported an internal failure: ${data.error}`);
      }
      qaData = data;
      lastQaError = null;
      break; // Success
    } catch (err) {
      lastQaError = err instanceof Error ? err : new Error(String(err));
      console.warn(`${logPrefix} Quality check tool failed on attempt ${attempt}: ${lastQaError.message}`);
      if (attempt < QA_MAX_RETRIES) {
        const delay = 15000 * Math.pow(2, attempt - 1); // Exponential backoff: 15s, 30s, 60s
        await new Promise((resolve)=>setTimeout(resolve, delay));
      }
    } finally {
        personBlob = null;
        garmentBlob = null;
        await Promise.resolve(); // give GC a chance before retry
    }
  }
  if (lastQaError) {
    console.error(`${logPrefix} Quality check tool failed after all retries. Using fallback. Last error: ${lastQaError.message}`);
    qaData = {
      action: 'select',
      best_image_index: 0,
      reasoning: `QA tool failed with error: ${lastQaError.message}. Selecting the first image as a fallback to prevent job failure.`
    };
  }
  if (!qaData || !qaData.action) {
    throw new Error("Quality checker returned invalid data after all retries and fallbacks.");
  }
  console.log(`[VTO_QA_DECISION][${pair_job_id}] Full AI Response: ${safeStringify(qaData, 8000)}`);
  const qa_history = metadata.qa_history || [];
  const newHistoryEntry = {
    pass_number: qa_retry_count + 1,
    ...qaData
  };
  qa_history.push(newHistoryEntry);
  const bestImage = variations[qaData.best_image_index];
  if (!bestImage || !bestImage.base64Image) {
    throw new Error(`Job failed at QA handoff: selected image index ${qaData.best_image_index} is missing or corrupt.`);
  }
  if (qaData.action === 'retry') {
    if (is_escalation_check) {
      if (ENABLE_BITSTUDIO_FALLBACK) {
        console.log(`${logPrefix} Final QA check failed. Escalating to BitStudio fallback by throwing an error.`);
        throw new Error("All generation attempts with the primary engine failed. Escalating to fallback.");
      } else {
        console.warn(`${logPrefix} Final QA check failed and fallback is disabled. Setting job to 'awaiting_finalization'.`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
          status: 'awaiting_finalization',
          metadata: {
            ...job.metadata,
            qa_history: qa_history,
            final_image_base64: bestImage.base64Image,
            finalization_reason: `Generation quality was low, but this was the best available result. QA Reasoning: ${qaData.reasoning}`
          }
        }).eq('id', job.id);
        console.log(`${logPrefix} Job is now awaiting finalization by the watchdog.`);
        return;
      }
    } else {
      console.log(`${logPrefix} QA requested a retry. Incrementing retry count and starting next generation pass.`);
      const nextStep = `generate_step_${qa_retry_count + 2}`;
      await supabase.from('mira-agent-bitstudio-jobs').update({
        metadata: {
          ...metadata,
          qa_history: qa_history,
          qa_retry_count: qa_retry_count + 1,
          google_vto_step: nextStep,
          generated_variations: variations
        }
      }).eq('id', pair_job_id);
      await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
        pair_job_id: job.id
      });
      return;
    }
  }
  if (qaData.action === 'select') {
    console.log(`${logPrefix} QA selected an image. Proceeding to next step.`);
    const bestImageBase64 = bestImage.base64Image;
    const bestImageUrl = await uploadBase64ToStorage(supabase, bestImageBase64, job.user_id, 'qa_best.png');
    await supabase.from('mira-agent-bitstudio-jobs').update({
      metadata: {
        ...metadata,
        qa_history: qa_history,
        qa_best_image_base64: bestImageBase64,
        qa_best_image_url: bestImageUrl.publicUrl,
        google_vto_step: 'outfit_completeness_check'
      },
      status: 'outfit_completeness_check'
    }).eq('id', job.id);
    await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
      pair_job_id: job.id
    });
  }
}

async function handleOutfitCompletenessCheck(supabase: SupabaseClient, job: any, logPrefix: string) {
  await supabase.from('mira-agent-bitstudio-jobs').update({
    status: 'outfit_completeness_check'
  }).eq('id', job.id);
  console.log(`${logPrefix} Performing outfit completeness check.`);
  const { metadata, id: pair_job_id } = job;
  const { qa_best_image_base64, garment_analysis, auto_complete_outfit } = metadata;
  if (auto_complete_outfit === false || !garment_analysis?.type_of_fit) {
    console.log(`${logPrefix} Skipping outfit check. Auto-complete: ${auto_complete_outfit}, Garment Fit: ${garment_analysis?.type_of_fit}`);
    await supabase.from('mira-agent-bitstudio-jobs').update({
      metadata: {
        ...metadata,
        google_vto_step: 'reframe',
        outfit_analysis_skipped: true
      },
      status: 'reframe'
    }).eq('id', job.id);
    await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
      pair_job_id: job.id
    });
    return;
  }
  let analysisData;
  let lastAnalysisError = null;
  for(let attempt = 1; attempt <= OUTFIT_ANALYSIS_MAX_RETRIES; attempt++){
    try {
      console.log(`${logPrefix} Attempt ${attempt}/${OUTFIT_ANALYSIS_MAX_RETRIES} to analyze outfit completeness...`);
      const { data, error: analysisError } = await supabase.functions.invoke('MIRA-AGENT-analyzer-outfit-completeness', {
        body: {
          image_to_analyze_base64: qa_best_image_base64,
          vto_garment_type: garment_analysis.type_of_fit
        }
      });
      if (analysisError) throw new Error(`Outfit completeness analysis failed: ${analysisError.message}`);
      analysisData = data;
      lastAnalysisError = null; // Clear error on success
      break; // Success, exit loop
    } catch (err) {
      lastAnalysisError = err instanceof Error ? err : new Error(String(err));
      console.warn(`${logPrefix} Outfit completeness analysis attempt ${attempt} failed: ${lastAnalysisError.message}`);
      if (attempt < OUTFIT_ANALYSIS_MAX_RETRIES) {
        await new Promise((resolve)=>setTimeout(resolve, OUTFIT_ANALYSIS_RETRY_DELAY_MS * attempt));
      }
    }
  }
  if (lastAnalysisError) {
    console.error(`${logPrefix} Outfit completeness analysis failed after all retries. Final error: ${lastAnalysisError.message}`);
    if (FAIL_ON_OUTFIT_ANALYSIS_ERROR) {
      throw lastAnalysisError;
    } else {
      console.warn(`${logPrefix} FAIL_ON_OUTFIT_ANALYSIS_ERROR is false. Skipping auto-complete and proceeding to reframe.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({
        metadata: {
          ...metadata,
          google_vto_step: 'reframe',
          outfit_analysis_skipped: true,
          outfit_analysis_error: lastAnalysisError.message
        },
        status: 'reframe'
      }).eq('id', job.id);
      await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
        pair_job_id: job.id
      });
      return;
    }
  }
  const fullAnalysisLog = {
    ...analysisData,
    vto_garment_type: garment_analysis.type_of_fit
  };
  console.log(`[VTO_OUTFIT_COMPLETENESS_ANALYSIS][${pair_job_id}] Full Analysis: ${safeStringify(fullAnalysisLog, 8000)}`);
  if (analysisData.is_outfit_complete || analysisData.missing_items.length === 0) {
    console.log(`${logPrefix} Outfit is complete. Proceeding to reframe.`);
    await supabase.from('mira-agent-bitstudio-jobs').update({
      metadata: {
        ...metadata,
        google_vto_step: 'reframe',
        outfit_completeness_analysis: fullAnalysisLog
      },
      status: 'reframe'
    }).eq('id', job.id);
    await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', {
      pair_job_id: job.id
    });
  } else {
    console.log(`${logPrefix} Outfit incomplete. Missing: ${analysisData.missing_items[0]}. Setting status to 'awaiting_stylist_choice' and invoking stylist.`);
    await supabase.from('mira-agent-bitstudio-jobs').update({
      status: 'awaiting_stylist_choice',
      metadata: {
        ...metadata,
        google_vto_step: 'awaiting_stylist_choice',
        outfit_completeness_analysis: fullAnalysisLog
      }
    }).eq('id', job.id);
    await invokeNextStep(supabase, 'MIRA-AGENT-stylist-chooser', {
      pair_job_id: job.id
    });
    console.log(`${logPrefix} Stylist invoked. Worker is now paused for this job.`);
  }
}

async function handleAutoComplete(supabase: SupabaseClient, job: any, logPrefix: string) {
  await supabase.from('mira-agent-bitstudio-jobs').update({
    status: 'awaiting_auto_complete'
  }).eq('id', job.id);
  console.log(`${logPrefix} Handling auto-complete step.`);
  const { metadata, user_id, id: parent_job_id } = job;
  const { chosen_completion_garment, qa_best_image_base64, qa_best_image_url } = metadata;
  if (!chosen_completion_garment || (!qa_best_image_base64 && !qa_best_image_url)) {
    throw new Error("Job is in auto-complete state but is missing chosen garment or the base image data/URL.");
  }
  let personImageUrl = qa_best_image_url;
  if (!personImageUrl) {
    console.log(`${logPrefix} qa_best_image_url not found, generating from base64.`);
    const uploadedImage = await uploadBase64ToStorage(supabase, qa_best_image_base64, user_id, 'qa_best_re-uploaded.png');
    personImageUrl = uploadedImage.publicUrl;
  }
  console.log(`${logPrefix} Creating new VTO generation pass to add chosen garment: ${chosen_completion_garment.name}`);
  const { data: vtoResult, error: vtoError } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
    body: {
      person_image_url: personImageUrl,
      garment_image_url: chosen_completion_garment.storage_path,
      sample_count: 1
    }
  });
  if (vtoError) throw new Error(`Auto-complete VTO generation failed: ${vtoError.message}`);
  const finalImageBase64 = vtoResult?.generatedImages?.[0]?.base64Image;
  if (!finalImageBase64) throw new Error("Auto-complete VTO did not return a valid image.");
  if (job.metadata.skip_reframe === true) {
    console.log(`${logPrefix} Auto-complete finished. 'skip_reframe' is true. Setting job to 'awaiting_finalization'.`);
    await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'awaiting_finalization',
        metadata: {
            ...job.metadata,
            final_image_base64: finalImageBase64,
            finalization_reason: "Auto-completed outfit, reframe skipped."
        }
    }).eq('id', job.id);
    console.log(`${logPrefix} Job is now awaiting finalization by the watchdog.`);
  } else {
    console.log(`${logPrefix} Auto-complete generation successful. Invoking reframe proxy.`);
    const { data: reframeJobData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-reframe-fal', {
      body: {
        user_id: user_id,
        base_image_url: (await uploadBase64ToStorage(supabase, finalImageBase64, user_id, 'reframe-base.png')).publicUrl,
        prompt: metadata.prompt_appendix || "",
        aspect_ratio: metadata.final_aspect_ratio,
        parent_vto_job_id: parent_job_id
      }
    });
    if (proxyError) throw new Error(`Failed to invoke reframe proxy: ${proxyError.message}`);
    await supabase.from('mira-agent-bitstudio-jobs').update({
      status: 'awaiting_reframe',
      metadata: {
        ...metadata,
        google_vto_step: 'awaiting_reframe',
        delegated_reframe_job_id: reframeJobData.jobId,
        qa_best_image_base64: null
      }
    }).eq('id', parent_job_id);
    console.log(`${logPrefix} Auto-complete finished. Handed off to reframe job ${reframeJobData.jobId}.`);
  }
}

async function handleReframe(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Final step: Reframe.`);
  const { qa_best_image_base64, qa_best_image_url, final_aspect_ratio, prompt_appendix } = job.metadata;
  if (!qa_best_image_base64 && !qa_best_image_url) throw new Error("Missing best VTO image for reframe step.");
  
  if (job.metadata.skip_reframe === true || job.metadata.final_aspect_ratio === '1:1') {
    console.log(`${logPrefix} Reframe skipped as per configuration. Setting job to 'awaiting_finalization'.`);
    const base64 = qa_best_image_base64 || await blobToBase64(await safeDownload(supabase, qa_best_image_url, logPrefix));
    await supabase.from('mira-agent-bitstudio-jobs').update({
      status: 'awaiting_finalization',
      metadata: { ...job.metadata, final_image_base64: base64, finalization_reason: "Reframe skipped as per configuration." }
    }).eq('id', job.id);
    console.log(`${logPrefix} Job is now awaiting finalization by the watchdog.`);
  } else {
    try {
      const baseImageUrl = qa_best_image_url || (await uploadBase64ToStorage(supabase, qa_best_image_base64, job.user_id, 'reframe-base.png')).publicUrl;
      const { data: reframeJobData, error: reframeError } = await supabase.functions.invoke('MIRA-AGENT-proxy-reframe-fal', {
        body: {
          user_id: job.user_id,
          base_image_url: baseImageUrl,
          prompt: prompt_appendix || "",
          aspect_ratio: final_aspect_ratio,
          parent_vto_job_id: job.id
        }
      });
      if (reframeError) throw new Error(reframeError.message || 'Reframe proxy failed.');
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'awaiting_reframe',
        metadata: { ...job.metadata, google_vto_step: 'awaiting_reframe', delegated_reframe_job_id: reframeJobData.jobId, qa_best_image_base64: null }
      }).eq('id', job.id);
      console.log(`${logPrefix} Handed off to reframe job ${reframeJobData.jobId}. This VTO job is now awaiting the final result.`);
    } catch (error) {
      // This block handles failures in the reframe dispatch itself.
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`${logPrefix} Reframe dispatch failed:`, errorMessage);
      const reframe_retry_count = (job.metadata.reframe_retry_count || 0) + 1;
      if (reframe_retry_count < MAX_REFRAME_RETRIES) {
        console.log(`${logPrefix} Attempting retry ${reframe_retry_count}/${MAX_REFRAME_RETRIES}...`);
        await supabase.from('mira-agent-bitstudio-jobs').update({ metadata: { ...job.metadata, reframe_retry_count } }).eq('id', job.id);
        await invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
      } else {
        console.error(`${logPrefix} Reframe failed after ${MAX_REFRAME_RETRIES} retries. Falling back to 1:1 image.`);
        const base64 = qa_best_image_base64 || await blobToBase64(await safeDownload(supabase, qa_best_image_url, logPrefix));
        await supabase.from('mira-agent-bitstudio-jobs').update({
          status: 'awaiting_finalization',
          metadata: { ...job.metadata, final_image_base64: base64, finalization_reason: `Reframe failed after ${MAX_REFRAME_RETRIES} attempts: ${errorMessage}` }
        }).eq('id', job.id);
        console.log(`${logPrefix} Job is now awaiting finalization by the watchdog.`);
      }
    }
  }
}

async function handleAwaitingReframe(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Step: AWAITING_REFRAME. Checking on delegated job.`);
  const reframeJobId = job.metadata?.delegated_reframe_job_id;
  if (!reframeJobId) throw new Error("Job is in 'awaiting_reframe' state but is missing the 'delegated_reframe_job_id' in metadata.");
  
  const { data: reframeJob, error: fetchError } = await supabase.from('fal_reframe_jobs').select('status, final_result, error_message, updated_at').eq('id', reframeJobId).single();
  if (fetchError) {
    console.warn(`${logPrefix} Could not fetch status of reframe job ${reframeJobId}. Will retry on next watchdog cycle. Error: ${fetchError.message}`);
    await supabase.from('mira-agent-bitstudio-jobs').update({ updated_at: new Date().toISOString() }).eq('id', job.id);
    return;
  }

  if (reframeJob.status === 'complete') {
    console.log(`${logPrefix} Delegated reframe job ${reframeJobId} is complete. Finalizing VTO job.`);
    const finalImageUrl = reframeJob.final_result?.publicUrl;
    if (!finalImageUrl) throw new Error(`Reframe job ${reframeJobId} completed but did not return a final image URL.`);
    await supabase.from('mira-agent-bitstudio-jobs').update({
      status: 'complete',
      final_image_url: finalImageUrl,
      metadata: { ...job.metadata, google_vto_step: 'done' }
    }).eq('id', job.id);
    console.log(`${logPrefix} VTO job successfully finalized.`);
    return;
  }

  if (reframeJob.status === 'failed') {
    console.error(`${logPrefix} Delegated reframe job ${reframeJobId} has failed. Failing parent VTO job.`);
    await supabase.from('mira-agent-bitstudio-jobs').update({
      status: 'failed',
      error_message: `Delegated reframe job failed: ${reframeJob.error_message}`
    }).eq('id', job.id);
    return;
  }

  const lastUpdate = new Date(reframeJob.updated_at).getTime();
  const now = Date.now();
  const secondsSinceUpdate = (now - lastUpdate) / 1000;
  if (secondsSinceUpdate > REFRAME_STALL_THRESHOLD_SECONDS) {
    console.warn(`${logPrefix} STALL DETECTED! Reframe job ${reframeJobId} has not been updated for ${secondsSinceUpdate.toFixed(0)}s. Retrying...`);
    await supabase.from('fal_reframe_jobs').delete().eq('id', reframeJobId);
    await handleReframe(supabase, job, logPrefix); // Re-trigger the reframe logic
  } else {
    console.log(`${logPrefix} Reframe job ${reframeJobId} is still in progress. Waiting for next watchdog cycle.`);
    await supabase.from('mira-agent-bitstudio-jobs').update({ updated_at: new Date().toISOString() }).eq('id', job.id);
  }
}