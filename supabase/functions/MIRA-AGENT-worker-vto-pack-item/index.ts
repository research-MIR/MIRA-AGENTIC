import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import imageSize from "https://esm.sh/image-size";

// --- Constants ---
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TEMP_UPLOAD_BUCKET = 'mira-agent-user-uploads';
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const MAX_QA_RETRIES = 3;
const OUTFIT_ANALYSIS_MAX_RETRIES = 3;
const OUTFIT_ANALYSIS_RETRY_DELAY_MS = 1000;
const FAIL_ON_OUTFIT_ANALYSIS_ERROR = false;
const BITSTUDIO_FALLBACK_ENABLED = false; // Control flag for the fallback logic

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Utility Functions ---
function invokeNextStep(supabase: SupabaseClient, functionName: string, payload: object) {
  supabase.functions.invoke(functionName, { body: payload }).catch(error => {
    console.error(`[invokeNextStep] FIRE-AND-FORGET invocation for ${functionName} failed. Watchdog will recover. Error:`, error);
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
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) throw error;
    if (!data) throw new Error(`[safeDownload:${path}] data missing`);
    console.log(`${logPrefix} [safeDownload] Download successful. Blob size: ${data.size}`);
    return data;
}

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(new Uint8Array(buffer));
};

async function uploadBase64ToStorage(supabase: SupabaseClient, base64: string, userId: string, filename: string) {
    const { decodeBase64 } = await import("https://deno.land/std@0.224.0/encoding/base64.ts");
    const buffer = decodeBase64(base64);
    const filePath = `${userId}/vto-pack-results/${Date.now()}-${filename}`;
    const { error } = await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return { publicUrl, storagePath: filePath };
}

// --- State Handlers ---

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
        metadata: { ...job.metadata, bbox_person: personBox, google_vto_step: 'prepare_assets_person' }
    }).eq('id', job.id);

    console.log(`${logPrefix} Bounding box saved. Advancing to 'prepare_assets_person'.`);
    invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function handlePrepareAssetsPerson(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Step 2a: Preparing person asset.`);
    const { source_person_image_url, metadata } = job;
    const personBox = metadata.bbox_person;
    if (!personBox) throw new Error("Cannot prepare assets: bbox_person is missing from metadata.");

    const personBlob = await safeDownload(supabase, source_person_image_url, logPrefix);
    const personImage = await ISImage.decode(await personBlob.arrayBuffer());
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
    const croppedPersonBlob = new Blob([croppedPersonBuffer], { type: 'image/jpeg' });
    const tempPersonPath = `tmp/${job.user_id}/${Date.now()}-cropped_person.jpeg`;
    await supabase.storage.from(TEMP_UPLOAD_BUCKET).upload(tempPersonPath, croppedPersonBlob, { contentType: "image/jpeg" });
    const { data: { publicUrl: croppedPersonUrl } } = supabase.storage.from(TEMP_UPLOAD_BUCKET).getPublicUrl(tempPersonPath);
    console.log(`${logPrefix} Cropped person image uploaded to temp storage.`);

    await supabase.from('mira-agent-bitstudio-jobs').update({
        metadata: { ...metadata, bbox: bbox, cropped_person_url: croppedPersonUrl, google_vto_step: 'prepare_assets_garment' }
    }).eq('id', job.id);

    console.log(`${logPrefix} Person asset prepared. Advancing to 'prepare_assets_garment'.`);
    invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function handlePrepareAssetsGarment(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Step 2b: Preparing garment asset.`);
    const { source_garment_image_url, metadata } = job;

    const garmentBlob = await safeDownload(supabase, source_garment_image_url, logPrefix);
    const garmentImage = await ISImage.decode(await garmentBlob.arrayBuffer());
    
    const MAX_GARMENT_DIMENSION = 2048;
    if (Math.max(garmentImage.width, garmentImage.height) > MAX_GARMENT_DIMENSION) {
        garmentImage.resize(
            garmentImage.width > garmentImage.height ? MAX_GARMENT_DIMENSION : ISImage.RESIZE_AUTO,
            garmentImage.height > garmentImage.width ? MAX_GARMENT_DIMENSION : ISImage.RESIZE_AUTO
        );
    }
    const optimizedGarmentBuffer = await garmentImage.encodeJPEG(75);
    const optimizedGarmentBlob = new Blob([optimizedGarmentBuffer], { type: 'image/jpeg' });
    const tempGarmentPath = `tmp/${job.user_id}/${Date.now()}-optimized_garment.jpeg`;
    await supabase.storage.from(TEMP_UPLOAD_BUCKET).upload(tempGarmentPath, optimizedGarmentBlob, { contentType: "image/jpeg" });
    const { data: { publicUrl: optimizedGarmentUrl } } = supabase.storage.from(TEMP_UPLOAD_BUCKET).getPublicUrl(tempGarmentPath);
    console.log(`${logPrefix} Optimized garment image uploaded to temp storage.`);

    await supabase.from('mira-agent-bitstudio-jobs').update({
        metadata: { ...metadata, optimized_garment_url: optimizedGarmentUrl, google_vto_step: 'generate_step_1' }
    }).eq('id', job.id);

    console.log(`${logPrefix} Garment asset prepared. Advancing to 'generate_step_1'.`);
    invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
}

async function handleGenerateStep(supabase: SupabaseClient, job: any, sampleStep: number, nextStep: string, logPrefix: string) {
    console.log(`${logPrefix} Generating variation with ${sampleStep} steps.`);
    const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
        body: {
            person_image_url: job.metadata.cropped_person_url,
            garment_image_url: job.metadata.optimized_garment_url,
            sample_count: 3,
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
    const is_escalation_check = qa_retry_count >= MAX_QA_RETRIES - 1;

    if (bitstudio_result_url) {
        console.log(`${logPrefix} BitStudio fallback result provided. This is the absolute final attempt.`);
        const bitstudioBlob = await safeDownload(supabase, bitstudio_result_url, logPrefix);
        variations.push({ base64Image: await blobToBase64(bitstudioBlob) });
    }

    if (!variations || !Array.isArray(variations) || variations.length === 0) {
        throw new Error("No variations generated for quality check.");
    }

    let qaData;
    try {
        let [personBlob, garmentBlob] = await Promise.all([
            safeDownload(supabase, job.source_person_image_url, logPrefix),
            safeDownload(supabase, job.source_garment_image_url, logPrefix)
        ]);

        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-quality-checker', {
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

        if (error) throw error;
        qaData = data;
        if (!qaData || !qaData.action) throw new Error("Quality checker returned invalid data");
    } catch (err) {
        console.error(`${logPrefix} Quality check tool failed: ${err.message}. Overriding to 'select' the first image as a fallback.`);
        qaData = {
            action: 'select',
            best_image_index: 0,
            reasoning: `QA tool failed with error: ${err.message}. Selecting the first image as a fallback to prevent job failure.`
        };
    }

    const qa_history = metadata.qa_history || [];
    const newHistoryEntry = { pass_number: qa_retry_count + 1, ...qaData };
    qa_history.push(newHistoryEntry);

    if (qaData.action === 'retry') {
        if (is_escalation_check) {
            console.warn(`${logPrefix} QA requested a retry on a final attempt. Overriding to 'select' the best available image (index ${qaData.best_image_index}) to prevent job failure.`);
            qaData.action = 'select';
        } else {
            const nextStepNumber = qa_retry_count + 2;
            const nextStep = `generate_step_${nextStepNumber}`;
            console.log(`${logPrefix} QA requested a retry. Incrementing retry count. Next step: ${nextStep}.`);
            await supabase.from('mira-agent-bitstudio-jobs').update({
                metadata: { ...metadata, qa_history: qa_history, qa_retry_count: qa_retry_count + 1, google_vto_step: nextStep, generated_variations: [] } // Clear variations for next pass
            }).eq('id', pair_job_id);
            invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
            return;
        }
    }

    if (qaData.action === 'select') {
        console.log(`${logPrefix} QA selected an image. Proceeding to finalize.`);
        const bestImageBase64 = variations[qaData.best_image_index].base64Image;
        const bestImageUrl = await uploadBase64ToStorage(supabase, bestImageBase64, job.user_id, 'qa_best.png');
        await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: { ...metadata, qa_history: qa_history, qa_best_image_base64: bestImageBase64, qa_best_image_url: bestImageUrl.publicUrl, google_vto_step: 'outfit_completeness_check' }
        }).eq('id', job.id);
        invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
    }
}

async function handleOutfitCompletenessCheck(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Performing outfit completeness check.`);
    const { metadata, id: pair_job_id } = job;
    const { qa_best_image_base64, garment_analysis, auto_complete_outfit } = metadata;

    if (auto_complete_outfit === false || !garment_analysis?.type_of_fit) {
        console.log(`${logPrefix} Skipping outfit check. Auto-complete: ${auto_complete_outfit}, Garment Fit: ${garment_analysis?.type_of_fit}`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
            metadata: { ...metadata, google_vto_step: 'reframe', outfit_analysis_skipped: true }
        }).eq('id', job.id);
        invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
        return;
    }

    let analysisData;
    let lastAnalysisError: Error | null = null;

    for (let attempt = 1; attempt <= OUTFIT_ANALYSIS_MAX_RETRIES; attempt++) {
        try {
            const { data, error: analysisError } = await supabase.functions.invoke('MIRA-AGENT-analyzer-outfit-completeness', {
                body: { image_to_analyze_base64: qa_best_image_base64, vto_garment_type: garment_analysis.type_of_fit }
            });
            if (analysisError) throw new Error(`Outfit completeness analysis failed: ${analysisError.message}`);
            analysisData = data;
            lastAnalysisError = null;
            break;
        } catch (err) {
            lastAnalysisError = err instanceof Error ? err : new Error(String(err));
            if (attempt < OUTFIT_ANALYSIS_MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, OUTFIT_ANALYSIS_RETRY_DELAY_MS * attempt));
            }
        }
    }

    if (lastAnalysisError) {
        if (FAIL_ON_OUTFIT_ANALYSIS_ERROR) {
            throw lastAnalysisError;
        } else {
            console.warn(`${logPrefix} Outfit analysis failed after all retries. Skipping auto-complete and proceeding to reframe.`);
            await supabase.from('mira-agent-bitstudio-jobs').update({
                metadata: { ...metadata, google_vto_step: 'reframe', outfit_analysis_skipped: true, outfit_analysis_error: lastAnalysisError.message }
            }).eq('id', job.id);
            invokeNextStep(supabase, 'MIRA-AGENT-worker-vto-pack-item', { pair_job_id: job.id });
            return;
        }
    }

    const fullAnalysisLog = { ...analysisData, vto_garment_type: garment_analysis.type_of_fit };

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
    }
}

async function handleAutoComplete(supabase: SupabaseClient, job: any, logPrefix: string) {
    console.log(`${logPrefix} Handling auto-complete step.`);
    const { metadata, user_id, id: parent_job_id } = job;
    const { chosen_completion_garment, qa_best_image_base64, qa_best_image_url } = metadata;

    if (!chosen_completion_garment || (!qa_best_image_base64 && !qa_best_image_url)) {
        throw new Error("Job is in auto-complete state but is missing chosen garment or the base image data/URL.");
    }

    let personImageUrl = qa_best_image_url;
    if (!personImageUrl) {
        const uploadedImage = await uploadBase64ToStorage(supabase, qa_best_image_base64, user_id, 'qa_best_re-uploaded.png');
        personImageUrl = uploadedImage.publicUrl;
    }
    
    const { data: vtoResult, error: vtoError } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
        body: {
            person_image_url: personImageUrl,
            garment_image_url: chosen_completion_garment.storage_path,
            sample_count: 1,
        }
    });
    if (vtoError) throw new Error(`Auto-complete VTO generation failed: ${vtoError.message}`);
    
    const finalImageBase64 = vtoResult?.generatedImages?.[0]?.base64Image;
    if (!finalImageBase64) throw new Error("Auto-complete VTO did not return a valid image.");

    const { data: reframeJobData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-reframe', {
        body: {
            user_id: user_id,
            base_image_base64: finalImageBase64,
            prompt: metadata.prompt_appendix || "",
            aspect_ratio: metadata.final_aspect_ratio,
            source: 'reframe_from_vto',
            parent_vto_job_id: parent_job_id
        }
    });
    if (proxyError) throw new Error(`Failed to invoke reframe proxy: ${proxyError.message}`);

    await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'awaiting_reframe',
        metadata: { 
            ...metadata, 
            google_vto_step: 'done',
            delegated_reframe_job_id: reframeJobData.jobId,
            qa_best_image_base64: null
        }
    }).eq('id', parent_job_id);
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
    }
}

// --- Main Serve Function ---
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
                await handlePrepareAssetsPerson(supabase, job, logPrefix);
                break;
            case 'prepare_assets_person':
                await handlePrepareAssetsPerson(supabase, job, logPrefix);
                break;
            case 'prepare_assets_garment':
                await handlePrepareAssetsGarment(supabase, job, logPrefix);
                break;
            case 'generate_step_1':
                await handleGenerateStep(supabase, job, 15, 'quality_check_1', logPrefix);
                break;
            case 'quality_check_1':
                await handleQualityCheck(supabase, job, logPrefix);
                break;
            case 'generate_step_2':
                await handleGenerateStep(supabase, job, 30, 'quality_check_2', logPrefix);
                break;
            case 'quality_check_2':
                await handleQualityCheck(supabase, job, logPrefix);
                break;
            case 'generate_step_3':
                await handleGenerateStep(supabase, job, 50, 'quality_check_3', logPrefix);
                break;
            case 'quality_check_3':
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
            case 'done':
            case 'fallback_to_bitstudio':
            case 'awaiting_stylist_choice':
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
    if (BITSTUDIO_FALLBACK_ENABLED && job && (currentStep?.startsWith('generate_step') || currentStep?.startsWith('quality_check'))) {
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
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', pair_job_id);
        return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
    }
  }
});