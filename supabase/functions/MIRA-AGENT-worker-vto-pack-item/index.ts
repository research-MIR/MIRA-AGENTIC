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

async function triggerWatchdog(supabase: SupabaseClient, logPrefix: string) {
  console.log(`${logPrefix} Job has terminated. Triggering watchdog to start next job.`);
  for (let i = 0; i < 3; i++) {
    const { error } = await supabase.functions.invoke('MIRA-AGENT-watchdog-background-jobs', { body: {} });
    if (!error) {
      console.log(`${logPrefix} Watchdog invoked successfully.`);
      return;
    }
    console.error(`${logPrefix} Failed to invoke watchdog (attempt ${i + 1}/3):`, error.message);
    if (i < 2) await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.error(`${logPrefix} CRITICAL: Failed to invoke watchdog after 3 attempts. Next job will start on the next cron schedule.`);
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
    if (!bucket || !path) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${url}`);
    }
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
    console.log(`${logPrefix} Starting job.`);
    const { data: fetchedJob, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', pair_job_id).single();
    if (fetchError) throw new Error(fetchError.message || 'Failed to fetch job.');
    job = fetchedJob;
    console.log(`${logPrefix} Successfully fetched job data. Status: ${job.status}`);

    if (reframe_result_url) {
        console.log(`${logPrefix} Received reframe result. Finalizing job.`);
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'complete', final_image_url: reframe_result_url }).eq('id', pair_job_id);
        console.log(`${logPrefix} Job successfully finalized.`);
        await triggerWatchdog(supabase, logPrefix);
    } else if (bitstudio_result_url) {
        console.log(`${logPrefix} Received BitStudio fallback result. Running final quality check.`);
        await handleQualityCheck(supabase, job, logPrefix, bitstudio_result_url);
    } else {
        const step = job.metadata?.google_vto_step || 'start';
        console.log(`${logPrefix} Current step: ${step}`);
        switch (step) {
            case 'start':
                await handleStart(supabase, job, logPrefix);
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
            case 'awaiting_stylist_choice':
                await handleStylistChoice(supabase, job, logPrefix);
                break;
            case 'awaiting_auto_complete':
                await handleAutoComplete(supabase, job, logPrefix);
                break;
            case 'done':
            case 'fallback_to_bitstudio':
                console.log(`${logPrefix} Job is already in a terminal or waiting state ('${step}'). Exiting gracefully.`);
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
            
            await triggerWatchdog(supabase, logPrefix);
            return new Response(JSON.stringify({ success: true, message: "Escalated to BitStudio fallback." }), { headers: corsHeaders });

        } catch (fallbackError) {
            const fallbackErrorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            console.error(`${logPrefix} CRITICAL: BitStudio fallback attempt also failed:`, fallbackErrorMessage);
            await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Google VTO failed and BitStudio fallback also failed: ${fallbackErrorMessage}` }).eq('id', pair_job_id);
            await triggerWatchdog(supabase, logPrefix);
            return new Response(JSON.stringify({ error: fallbackErrorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
        }
    } else {
        if (job && (currentStep?.startsWith('generate_step') || currentStep?.startsWith('quality_check'))) {
            console.warn(`[BITSTUDIO_FALLBACK][${job.id}] Fallback is disabled. Job will fail.`);
        }
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', pair_job_id);
        await triggerWatchdog(supabase, logPrefix);
        return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
    }
  }
});