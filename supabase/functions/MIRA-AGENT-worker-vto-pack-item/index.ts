import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

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

const ENABLE_BITSTUDIO_FALLBACK = false; // FEATURE FLAG

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Hardened Safe Wrapper Functions ---
function invokeNextStep(supabase: SupabaseClient, functionName: string, payload: object) {
  supabase.functions.invoke(functionName, { body: payload })
    .catch(err => {
      console.error(`[invokeNextStep] Error invoking ${functionName}:`, err);
    });
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
    return { bucket, path };
}

async function safeDownload(supabase: SupabaseClient, publicUrl: string, logPrefix: string): Promise<Blob> {
    console.log(`${logPrefix} [safeDownload] Starting download for: ${publicUrl}`);
    const { bucket, path } = parseStorageURL(publicUrl);
    console.log(`${logPrefix} [safeDownload] Parsed URL. Bucket: ${bucket}, Path: ${path}`);
    const { data, error } = await supabase.storage.from(bucket).download(path).catch(e => { throw e ?? new Error(`[safeDownload:${path}] rejected with null`) });
    if (error) throw error ?? new Error(`[safeDownload:${path}] error was null`);
    if (!data) throw new Error(`[safeDownload:${path}] data missing`);
    console.log(`${logPrefix} [safeDownload] Download successful. Blob size: ${data.size}`);
    return data;
}

async function safeUpload(supabase: SupabaseClient, bucket: string, path: string, body: any, options: any) {
    const { error } = await supabase.storage.from(bucket).upload(path, body, options).catch(e => { throw e ?? new Error(`[safeUpload:${path}] rejected with null`) });
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
    await safeUpload(supabase, GENERATED_IMAGES_BUCKET, filePath, new Blob([buffer], { type: 'image/png' }), { contentType: 'image/png', upsert: true });
    const publicUrl = await safeGetPublicUrl(supabase, GENERATED_IMAGES_BUCKET, filePath);
    return { publicUrl, storagePath: filePath };
}

// --- Utility Functions ---
const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(new Uint8Array(buffer));
};

// --- State Machine Logic ---
serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { pair_job_id, reframe_result_url, bitstudio_result_url } = await req.json();
  if (!pair_job_id) {
    return new Response(JSON.stringify({ error: "pair_job_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-Pack-Worker][${pair_job_id}]`;
  let job;

  try {
    const { data: fetchedJob, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', pair_job_id).single();
    if (fetchError) throw new Error(fetchError.message || 'Failed to fetch job.');
    job = fetchedJob;

    if (reframe_result_url) {
        console.log(`${logPrefix} Received reframe result. Finalizing job.`);
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'complete', final_image_url: reframe_result_url }).eq('id', pair_job_id);
        console.log(`${logPrefix} Job successfully finalized.`);
    } else if (bitstudio_result_url) {
        console.log(`${logPrefix} Received BitStudio fallback result. Running final quality check.`);
        await handleQualityCheck(supabase, job, logPrefix, bitstudio_result_url);
    } else {
        console.log(`${logPrefix} Starting job.`);
        const step = job.metadata?.google_vto_step || 'start';
        console.log(`${logPrefix} Current step: ${step}`);
        switch (step) {
            case 'start':
                await handleStart_GetBbox(supabase, job, logPrefix);
                break;
            case 'prepare_assets':
                await handleStart_PrepareAssets(supabase, job, logPrefix);
                break;
            case 'generate_step_1':
                await handleGenerateStep(supabase, job, 15, 'quality_check', logPrefix);
                break;
            case 'generate_step_2':
                await handleGenerateStep(supabase, job, 30, 'quality_check_2', logPrefix);
                break;
            case 'generate_step_3':
                await handleGenerateStep(supabase, job, 45, 'quality_check_3', logPrefix);
                break;
            case 'quality_check':
                await handleQualityCheck(supabase, job, logPrefix);
                break;
            case 'quality_check_2':
                await handleQualityCheckPass2(supabase, job, logPrefix);
                break;
            case 'quality_check_3':
                await handleQualityCheckPass3(supabase, job, logPrefix);
                break;
            case 'outfit_completeness_check':
                await handleOutfitCompletenessCheck(supabase, job, logPrefix);
                break;
            case 'reframe':
                await handleReframe(supabase, job, logPrefix);
                break;
            case 'awaiting_auto_complete':
                await handleAutoComplete(supabase, job, logPrefix);
                break;
            case 'done':
            case 'fallback_to_bitstudio':
            case 'awaiting_stylist_choice': // This state is now handled by the stylist-chooser
                console.log(`${logPrefix} Job is in a waiting or terminal state ('${step}'). Exiting gracefully.`);
                break;
            default:
                throw new Error(`Unknown step: ${step}`);
        }
    }
    return new Response(JSON.stringify({ success: true, message: "Step initiated." }), { headers: corsHeaders });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix} Error:`, errorMessage);
    
    const currentStep = job?.metadata?.google_vto_step;
    if (job && (currentStep?.startsWith('generate_step') || currentStep?.startsWith('quality_check')) && ENABLE_BITSTUDIO_FALLBACK) {
        console.warn(`[BITSTUDIO_FALLBACK][${job.id}] A Google VTO generation or quality check step failed. Escalating to BitStudio. Triggering reason: ${errorMessage}`);
        try {
            await supabase.from('mira-agent-bitstudio-jobs').update({
                metadata: { ...job.metadata, google_vto_step: 'fallback_to_bitstudio', engine: 'bitstudio_fallback' }
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
                metadata: { ...job.metadata, delegated_bitstudio_job_id: proxyData.jobIds[0] }
            }).eq('id', pair_job_id);
            
            return new Response(JSON.stringify({ success: true, message: "Escalated to BitStudio fallback." }), { headers: corsHeaders });

        } catch (fallbackError) {
            const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            console.error(`${logPrefix} CRITICAL: BitStudio fallback attempt also failed:`, fallbackErrorMessage);
            await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Google VTO failed and BitStudio fallback also failed: ${fallbackErrorMessage}` }).eq('id', pair_job_id);
            return new Response(JSON.stringify({ error: fallbackErrorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
        }
    } else {
        if (job && (currentStep?.startsWith('generate_step') || currentStep?.startsWith('quality_check'))) {
            console.warn(`[BITSTUDIO_FALLBACK][${job.id}] Fallback is disabled. Job will fail.`);
        }
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', pair_job_id);
        return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
    }
  }
});

async function handleStart_GetBbox(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Step 1: Getting bounding box.`);
    const { data: bboxData, error: bboxError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-bbox', {
        body: { image_url: job.source_person_image_url, job_id: job.id }
    });
    if (bboxError) throw new Error(bboxError.message || 'BBox orchestrator failed.');
    const personBox = bboxData?.person;
    if (!personBox || !Array.isArray(personBox) || personBox.length !== 4 || personBox.some((v: any) => typeof v !== 'number')) {
        throw new Error("Orchestrator did not return a valid bounding box array.");
    }
    console.log(`${logPrefix} Bounding box received.`);

    await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'processing',
        metadata: { ...job.metadata, bbox_person: personBox, google_vto_step: 'prepare_assets' }
    }).eq('id', job.id);

    console.log(`${logPrefix} Bounding box saved. Advancing to 'prepare_assets'.`);
    invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function handleStart_PrepareAssets(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Step 2: Preparing and optimizing image assets.`);
    const { source_person_image_url, source_garment_image_url, metadata } = job;
    const personBox = metadata?.bbox_person;
    if (!personBox) throw new Error("Cannot prepare assets: bounding box data is missing from metadata.");

    let [personBlob, garmentBlob] = await Promise.all([
        safeDownload(supabase, source_person_image_url, logPrefix),
        safeDownload(supabase, source_garment_image_url, logPrefix)
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
        metadata: { ...job.metadata, bbox: bbox, cropped_person_url: croppedPersonUrl, optimized_garment_url: optimizedGarmentUrl, google_vto_step: 'generate_step_1' }
    }).eq('id', job.id);

    invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function invokeWithRetry(supabase: SupabaseClient, functionName: string, payload: object, maxRetries: number, logPrefix: string) {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
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
                const delay = 1500 * attempt;
                console.warn(`${logPrefix} Waiting ${delay}ms before retrying...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    throw lastError || new Error("Function failed after all retries without a specific error.");
}

async function handleGenerateStep(supabase: SupabaseClient, job: any, sampleStep: number, nextStep: string, logPrefix: string) {
    console.log(`${logPrefix} Generating variation with ${sampleStep} steps.`);
    const data = await invokeWithRetry(supabase, 'MIRA-AGENT-tool-virtual-try-on', {
        body: {
            person_image_url: job.metadata.cropped_person_url,
            garment_image_url: job.metadata.optimized_garment_url,
            sample_count: 3,
            sample_step: sampleStep
        }
    }, 3, logPrefix);

    const generatedImages = data?.generatedImages;
    if (!generatedImages || !Array.isArray(generatedImages) || generatedImages.length === 0 || !generatedImages[0]?.base64Image) {
        throw new Error(`VTO tool did not return a valid image for step ${sampleStep}`);
    }

    const currentVariations = job.metadata.generated_variations || [];
    await supabase.from('mira-agent-bitstudio-jobs').update({
        metadata: { ...job.metadata, generated_variations: [...currentVariations, ...generatedImages], google_vto_step: nextStep }
    }).eq('id', job.id);

    console.log(`${logPrefix} Step ${sampleStep} complete. Advancing to ${nextStep}.`);
    invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function handleQualityCheck(supabase: SupabaseClient, job: any, logPrefix: string, bitstudio_result_url?: string) {
    console.log(`${logPrefix} Performing quality check.`);
    const { metadata, id: pair_job_id } = job;
    const variations = metadata.generated_variations || [];
    const qa_retry_count = metadata.qa_retry_count || 0;
    let is_escalation_check = qa_retry_count >= 2;

    if (bitstudio_result_url) {
        console.log(`${logPrefix} BitStudio fallback result provided. This is the absolute final attempt.`);
        is_escalation_check = true;
        const bitstudioBlob = await safeDownload(supabase, bitstudio_result_url, logPrefix);
        variations.push({ base64Image: await blobToBase64(bitstudioBlob) });
    }

    if (!variations || !Array.isArray(variations) || variations.length === 0) {
        throw new Error("No variations generated for quality check.");
    }

    let [personBlob, garmentBlob] = await Promise.all([
        safeDownload(supabase, job.source_person_image_url, logPrefix),
        safeDownload(supabase, job.source_garment_image_url, logPrefix)
    ]);

    const { data: qaData, error } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-quality-checker', {
        body: {
            original_person_image_base64: await blobToBase64(personBlob),
            reference_garment_image_base64: await blobToBase64(garmentBlob),
            generated_images_base64: variations.map(img => img.base64Image),
            is_escalation_check: is_escalation_check,
            is_absolute_final_attempt: !!bitstudio_result_url
        }
    });
    personBlob = null; // GC
    garmentBlob = null; // GC

    if (error) throw new Error(error.message || 'QA tool invocation failed.');
    if (qaData.error) {
        console.warn(`[VTO-Pack-Worker-QA][${job.id}] The quality checker tool reported an internal failure: ${qaData.error}. Treating this as a failed check and retrying.`);
        qaData.action = 'retry';
        qaData.reasoning = `QA tool failed with error: ${qaData.error}. Retrying generation pass.`;
    }
    if (!qaData || !qaData.action) {
        throw new Error("Quality checker returned invalid data");
    }
    console.warn(`[VTO_QA_DECISION][${pair_job_id}] Full AI Response: ${JSON.stringify(qaData)}`);

    const qa_history = metadata.qa_history || [];
    const newHistoryEntry = { pass_number: qa_retry_count + 1, ...qaData };
    qa_history.push(newHistoryEntry);

    if (qaData.action === 'retry') {
        if (is_escalation_check) {
            if (ENABLE_BITSTUDIO_FALLBACK) {
                throw new Error("QA requested a retry on an escalation check, which should trigger the main catch block for fallback.");
            } else {
                console.warn(`[VTO-Pack-Worker-QA][${job.id}] Fallback disabled. QA requested retry on final attempt, but we are overriding to 'select' the best available image (index ${qaData.best_image_index}).`);
                qaData.action = 'select';
            }
        } else {
            console.log(`${logPrefix} QA requested a retry. Incrementing retry count and starting next generation pass.`);
            const nextStep = `generate_step_${qa_retry_count + 2}`;
            await supabase.from('mira-agent-bitstudio-jobs').update({
                metadata: { ...metadata, qa_history: qa_history, qa_retry_count: qa_retry_count + 1, google_vto_step: nextStep, generated_variations: [] }
            }).eq('id', pair_job_id);
            invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id });
            return;
        }
    }

    if (qaData.action === 'select') {
        console.log(`${logPrefix} QA selected an image. Proceeding to finalize.`);
        const bestImageBase64 = variations[qaData.best_image_index].base64Image;
        await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: { ...metadata, qa_history: qa_history, qa_best_image_base64: bestImageBase64, google_vto_step: 'outfit_completeness_check' }
        }).eq('id', job.id);
        invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
    }
}

async function handleOutfitCompletenessCheck(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Performing outfit completeness check.`);
    const { metadata, id: pair_job_id } = job;
    const { qa_best_image_base64, garment_analysis, auto_complete_outfit } = metadata;

    if (!auto_complete_outfit || !garment_analysis?.type_of_fit) {
        console.log(`${logPrefix} Skipping outfit check. Auto-complete: ${auto_complete_outfit}, Garment Fit: ${garment_analysis?.type_of_fit}`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: { ...metadata, google_vto_step: 'reframe' }
        }).eq('id', job.id);
        invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
        return;
    }

    const { data: analysisData, error: analysisError } = await supabase.functions.invoke('MIRA-AGENT-analyzer-outfit-completeness', {
        body: { image_to_analyze_base64: qa_best_image_base64, vto_garment_type: garment_analysis.type_of_fit }
    });
    if (analysisError) throw new Error(`Outfit completeness analysis failed: ${analysisError.message}`);

    const fullAnalysisLog = { ...analysisData, vto_garment_type: garment_analysis.type_of_fit };
    console.log(`[VTO_OUTFIT_COMPLETENESS_ANALYSIS][${pair_job_id}] Full Analysis: ${JSON.stringify(fullAnalysisLog)}`);

    if (analysisData.is_outfit_complete || analysisData.missing_items.length === 0) {
        console.log(`${logPrefix} Outfit is complete. Proceeding to reframe.`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: { ...metadata, google_vto_step: 'reframe', outfit_completeness_analysis: fullAnalysisLog }
        }).eq('id', job.id);
        invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
    } else {
        console.log(`${logPrefix} Outfit incomplete. Missing: ${analysisData.missing_items[0]}. Setting status to 'awaiting_stylist_choice' and invoking stylist.`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'awaiting_stylist_choice',
            metadata: { ...metadata, google_vto_step: 'awaiting_stylist_choice', outfit_completeness_analysis: fullAnalysisLog }
        }).eq('id', job.id);
        invokeNextStep(supabase, 'MIRA-AGENT-stylist-chooser', { pair_job_id: job.id });
        console.log(`${logPrefix} Stylist invoked. Worker is now paused for this job.`);
    }
}

async function handleAutoComplete(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Handling auto-complete step.`);
    const { metadata, user_id, id: parent_job_id } = job;
    const { chosen_completion_garment } = metadata;
    if (!chosen_completion_garment) {
        throw new Error("Job is in auto-complete state but has no chosen garment.");
    }
    console.log(`${logPrefix} Creating new VTO job to add chosen garment: ${chosen_completion_garment.name}`);

    const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
        user_id: user_id,
        vto_pack_job_id: job.vto_pack_job_id,
        mode: 'base',
        status: 'pending',
        source_person_image_url: job.metadata.qa_best_image_url,
        source_garment_image_url: chosen_completion_garment.storage_path,
        metadata: {
            engine: 'google',
            pass_number: 2,
            parent_vto_job_id: parent_job_id,
            cropping_mode: metadata.cropping_mode,
            final_aspect_ratio: metadata.final_aspect_ratio,
            skip_reframe: metadata.skip_reframe
        }
    }).select('id').single();
    if (insertError) throw new Error(`Failed to create auto-complete job: ${insertError.message}`);
    const childJobId = newJob.id;
    console.log(`${logPrefix} Created new auto-complete job with ID: ${childJobId}`);

    await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'awaiting_auto_complete',
        metadata: { ...metadata, delegated_auto_complete_job_id: childJobId }
    }).eq('id', parent_job_id);
    console.log(`${logPrefix} Parent job ${parent_job_id} updated to await child job ${childJobId}.`);
}

async function handleQualityCheckPass2(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Performing quality check for Pass 2.`);
    const { metadata, id: pair_job_id } = job;
    const variations = metadata.generated_variations || [];
    if (!variations || variations.length === 0) throw new Error("No variations found for Pass 2 quality check.");

    const garmentBlob = await safeDownload(supabase, job.source_garment_image_url, logPrefix);

    const { data: qaData, error } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-quality-checker', {
        body: {
            original_person_image_base64: metadata.qa_best_image_base64,
            reference_garment_image_base64: await blobToBase64(garmentBlob),
            generated_images_base64: variations.map(img => img.base64Image),
            is_escalation_check: true,
            is_absolute_final_attempt: false
        }
    });
    if (error) throw new Error(error.message || 'QA tool invocation failed for Pass 2.');
    console.warn(`[VTO_QA_DECISION_PASS_2][${pair_job_id}] Full AI Response: ${JSON.stringify(qaData)}`);

    const qa_history = metadata.qa_history || [];
    qa_history.push({ pass_number: 2, ...qaData });

    if (qaData.action === 'retry') {
        console.log(`${logPrefix} QA requested a retry on Pass 2. Starting Pass 3.`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: { ...metadata, qa_history: qa_history, qa_retry_count: 2, google_vto_step: 'generate_step_3', generated_variations: [] }
        }).eq('id', pair_job_id);
        invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id });
    } else {
        const bestImageBase64 = variations[qaData.best_image_index].base64Image;
        await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: { ...metadata, qa_history: qa_history, qa_best_image_base64: bestImageBase64, google_vto_step: 'outfit_completeness_check' }
        }).eq('id', job.id);
        invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
    }
}

async function handleQualityCheckPass3(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Performing quality check for Pass 3 (final pass).`);
    const { metadata, id: pair_job_id } = job;
    const variations = metadata.generated_variations || [];
    if (!variations || variations.length === 0) throw new Error("No variations found for Pass 3 quality check.");

    const garmentBlob = await safeDownload(supabase, job.source_garment_image_url, logPrefix);

    const { data: qaData, error } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-quality-checker', {
        body: {
            original_person_image_base64: metadata.qa_best_image_base64,
            reference_garment_image_base64: await blobToBase64(garmentBlob),
            generated_images_base64: variations.map(img => img.base64Image),
            is_escalation_check: true,
            is_absolute_final_attempt: true
        }
    });
    if (error) throw new Error(error.message || 'QA tool invocation failed for Pass 3.');
    console.warn(`[VTO_QA_DECISION_PASS_3][${pair_job_id}] Full AI Response: ${JSON.stringify(qaData)}`);

    const qa_history = metadata.qa_history || [];
    qa_history.push({ pass_number: 3, ...qaData });

    const bestImageBase64 = variations[qaData.best_image_index].base64Image;
    await supabase.from('mira-agent-bitstudio-jobs').update({
        metadata: { ...metadata, qa_history: qa_history, qa_best_image_base64: bestImageBase64, google_vto_step: 'outfit_completeness_check' }
    }).eq('id', job.id);
    invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function handleReframe(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Final step: Reframe.`);
    const { qa_best_image_base64, final_aspect_ratio, prompt_appendix, skip_reframe } = job.metadata;
    if (!qa_best_image_base64) throw new Error("Missing best VTO image for reframe step.");

    if (skip_reframe || final_aspect_ratio === '1:1') {
        console.log(`${logPrefix} Reframe is skipped. Finalizing job.`);
        const finalImage = await uploadBase64ToStorage(supabase, qa_best_image_base64, job.user_id, 'final_vto_pack.png');
        await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'complete',
            final_image_url: finalImage.publicUrl,
            metadata: { ...job.metadata, qa_best_image_base64: null, google_vto_step: 'done' }
        }).eq('id', job.id);
        console.log(`${logPrefix} Job finalized with 1:1 image.`);
    } else {
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
        if (reframeError) throw new Error(reframeError.message || 'Reframe proxy failed.');

        await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'awaiting_reframe',
            metadata: { ...job.metadata, google_vto_step: 'done', delegated_reframe_job_id: reframeJobData.jobId, qa_best_image_base64: null }
        }).eq('id', job.id);
        console.log(`${logPrefix} Handed off to reframe job ${reframeJobData.jobId}. This VTO job is now awaiting the final result.`);
    }
}