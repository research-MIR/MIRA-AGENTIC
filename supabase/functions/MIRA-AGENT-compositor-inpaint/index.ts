import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

// --- Instrumentation Helpers ---
const logStep = (logPrefix: string, step: string, extra: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), prefix: logPrefix, step, ...extra }));
};

const probeBuffer = async (logPrefix: string, name: string, ab: ArrayBuffer) => {
  const u8 = new Uint8Array(ab);
  const head = Array.from(u8.slice(0, 16));
  const len = u8.byteLength;
  const hashBuf = await crypto.subtle.digest("SHA-256", ab);
  const sha256 = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,"0")).join("");
  logStep(logPrefix, `${name}:buffer_probed`, { len, head, sha256 });
  return { u8, len, head, sha256 };
};

// --- Core Logic Helpers ---
async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array | null, userId: string, filename: string): Promise<string | null> {
    if (!buffer) return null;
    const filePath = `${userId}/vto-debug/${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) {
        console.error(`Storage upload failed for ${filename}: ${error.message}`);
        throw new Error(`Storage upload failed for ${filename}: ${error.message}`);
    }
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return publicUrl;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id, final_image_url, job_type = 'bitstudio' } = await req.json();
  if (!job_id || !final_image_url) throw new Error("job_id and final_image_url are required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[Compositor-Inpaint][${job_id}]`;
  logStep(logPrefix, "job_started", { type: job_type });

  const tableName = job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs';
  let problematicBuffer: ArrayBuffer | null = null;

  try {
    const { data: job, error: fetchError } = await supabase
      .from(tableName)
      .select('metadata, user_id')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    
    const metadata = job.metadata || {};
    const { full_source_image_url, bbox, cropped_dilated_mask_base64 } = metadata;

    if (!full_source_image_url || !bbox) {
        logStep(logPrefix, "legacy_job_skipped", { reason: "Missing full_source_image_url or bbox in metadata." });
        await supabase.from(tableName).update({ status: 'complete', final_image_url: final_image_url }).eq('id', job_id);
        return new Response(JSON.stringify({ success: true, message: "Legacy job finalized without composition." }), { headers: corsHeaders });
    }

    logStep(logPrefix, "assets_download_start");
    const [sourceBlob, inpaintedPatchResponse] = await Promise.all([
        downloadFromSupabase(supabase, full_source_image_url),
        fetch(final_image_url)
    ]);

    if (!inpaintedPatchResponse.ok) throw new Error(`Failed to download inpainted patch: ${inpaintedPatchResponse.statusText}`);
    
    logStep(logPrefix, "patch_headers_received", {
        contentType: inpaintedPatchResponse.headers.get('content-type'),
        contentLength: inpaintedPatchResponse.headers.get('content-length')
    });

    const patchBuffer = await inpaintedPatchResponse.arrayBuffer();
    problematicBuffer = patchBuffer;
    await probeBuffer(logPrefix, "patch_raw", patchBuffer);

    // --- Generate and Upload Debug Assets ---
    let final_compositing_mask_url: string | null = null;
    let feathered_mask_url: string | null = null;
    let croppedMaskImage: any = null;

    if (cropped_dilated_mask_base64) {
        const croppedMaskBuffer = decodeBase64(cropped_dilated_mask_base64);
        final_compositing_mask_url = await uploadBufferToStorage(supabase, croppedMaskBuffer, job.user_id, 'final_compositing_mask.png');
        croppedMaskImage = await loadImage(croppedMaskBuffer);

        const featheredCanvas = createCanvas(croppedMaskImage.width(), croppedMaskImage.height());
        const featheredCtx = featheredCanvas.getContext('2d');
        const featherAmount = Math.max(5, Math.round(bbox.width * 0.05));
        featheredCtx.filter = `blur(${featherAmount}px)`;
        featheredCtx.drawImage(croppedMaskImage, 0, 0);
        feathered_mask_url = await uploadBufferToStorage(supabase, featheredCanvas.toBuffer('image/png'), job.user_id, 'feathered_mask.png');
        logStep(logPrefix, "debug_assets_generated");
    }
    // --- End Debug Asset Generation ---

    logStep(logPrefix, "compositing_start_memory_efficient");

    // 1. Decode small patch first
    const inpaintedPatchImg = await loadImage(new Uint8Array(patchBuffer));
    logStep(logPrefix, "decoded_patch", { width: inpaintedPatchImg.width(), height: inpaintedPatchImg.height() });

    // 2. Create source crop
    const sourceImageForCrop = await loadImage(new Uint8Array(await sourceBlob.arrayBuffer()));
    const sourceCropCanvas = createCanvas(bbox.width, bbox.height);
    const sourceCropCtx = sourceCropCanvas.getContext('2d');
    sourceCropCtx.drawImage(sourceImageForCrop, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
    logStep(logPrefix, "created_source_crop", { width: bbox.width, height: bbox.height });

    // 3. Composite small buffers
    const blendedPatchCanvas = createCanvas(bbox.width, bbox.height);
    const blendedCtx = blendedPatchCanvas.getContext('2d');
    blendedCtx.drawImage(sourceCropCanvas, 0, 0);
    
    const featheredPatchCanvas = createCanvas(bbox.width, bbox.height);
    const featheredCtx = featheredPatchCanvas.getContext('2d');
    featheredCtx.drawImage(inpaintedPatchImg, 0, 0, bbox.width, bbox.height);

    if (croppedMaskImage) {
        featheredCtx.globalCompositeOperation = 'destination-in';
        const featherAmount = Math.max(5, Math.round(bbox.width * 0.05));
        featheredCtx.filter = `blur(${featherAmount}px)`;
        featheredCtx.drawImage(croppedMaskImage, 0, 0, bbox.width, bbox.height);
    }
    
    blendedCtx.drawImage(featheredPatchCanvas, 0, 0);
    logStep(logPrefix, "composited_small_buffers");

    // 4. Re-assemble final image
    const finalCanvas = createCanvas(sourceImageForCrop.width(), sourceImageForCrop.height());
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.drawImage(sourceImageForCrop, 0, 0);
    finalCtx.drawImage(blendedPatchCanvas, bbox.x, bbox.y);
    logStep(logPrefix, "final_image_reassembled");

    // 5. Encode and Upload using stable imagescript
    const finalImageData = finalCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
    const finalImage = new Image(finalCanvas.width, finalCanvas.height, finalImageData.data);
    const finalImageBuffer = await finalImage.encode(0);
    await probeBuffer(logPrefix, "final_encoded", finalImageBuffer);
    
    const finalFilePath = `${job.user_id}/vto-final/${Date.now()}_final_composite.png`;
    await uploadBufferToStorage(supabase, finalImageBuffer, job.user_id, 'final_composite.png');
    const { data: { publicUrl: finalPublicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);
    logStep(logPrefix, "composition_complete", { finalUrl: finalPublicUrl });

    let verificationResult = null;
    if (job.metadata?.reference_image_url) {
        logStep(logPrefix, "verification_start");
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-verify-garment-match', {
            body: { original_garment_url: job.metadata.reference_image_url, final_generated_url: finalPublicUrl }
        });
        if (error) {
            logStep(logPrefix, "verification_error", { error: error.message });
            verificationResult = { error: error.message, is_match: false };
        } else {
            verificationResult = data;
        }
        logStep(logPrefix, "verification_complete", { is_match: verificationResult?.is_match });
    }

    const finalMetadata = { 
        ...job.metadata, 
        verification_result: verificationResult,
        debug_assets: {
            ...job.metadata.debug_assets,
            final_compositing_mask_url,
            feathered_mask_url,
        }
    };

    if (verificationResult && verificationResult.is_match === false) {
        logStep(logPrefix, "qa_failed", { reason: verificationResult.mismatch_reason });
        const qaHistory = job.metadata?.qa_history || [];
        const newQaReportObject = { timestamp: new Date().toISOString(), report: verificationResult, failed_image_url: finalPublicUrl };
        await supabase.from(tableName).update({ status: 'awaiting_fix', metadata: { ...finalMetadata, qa_history: [...qaHistory, newQaReportObject] } }).eq('id', job_id);
        invokeNextStep(supabase, 'MIRA-AGENT-fixer-orchestrator', { job_id, qa_report_object: newQaReportObject });
    } else {
        logStep(logPrefix, "qa_passed_or_skipped");
        const updatePayload: any = { status: 'complete', final_image_url: finalPublicUrl, metadata: finalMetadata };
        if (tableName === 'mira-agent-inpainting-jobs') {
            updatePayload.final_result = { publicUrl: finalPublicUrl };
            delete updatePayload.final_image_url;
        }
        await supabase.from(tableName).update(updatePayload).eq('id', job_id);
    }

    logStep(logPrefix, "job_finished_successfully");
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    logStep(logPrefix, "job_failed", { error: error.message, stack: error.stack });
    if (problematicBuffer) {
        try {
            const debugPath = await uploadBufferToStorage(supabase, new Uint8Array(problematicBuffer), job_id, 'problematic_patch_buffer.bin');
            logStep(logPrefix, "panic_dump_success", { debugPath });
            await supabase.from(tableName).update({ status: 'failed', error_message: `Compositor failed: ${error.message}. Debug file: ${debugPath}` }).eq('id', job_id);
        } catch (dumpError) {
            logStep(logPrefix, "panic_dump_failed", { error: dumpError.message });
            await supabase.from(tableName).update({ status: 'failed', error_message: `Compositor failed: ${error.message}. Panic dump also failed.` }).eq('id', job_id);
        }
    } else {
        await supabase.from(tableName).update({ status: 'failed', error_message: `Compositor failed: ${error.message}` }).eq('id', job_id);
    }
    
    const { data: failedJob } = await supabase.from(tableName).select('metadata').eq('id', job_id).single();
    if (failedJob?.metadata?.batch_pair_job_id) {
        logStep(logPrefix, "propagating_failure", { parentJobId: failedJob.metadata.batch_pair_job_id });
        await supabase.from('mira-agent-batch-inpaint-pair-jobs')
            .update({ status: 'failed', error_message: `Compositor failed: ${error.message}` })
            .eq('id', failedJob.metadata.batch_pair_job_id);
    }

    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const publicSegmentIndex = pathSegments.indexOf('public');
    if (publicSegmentIndex === -1 || publicSegmentIndex + 1 >= pathSegments.length) {
        throw new Error(`Could not parse bucket name from URL: ${publicUrl}`);
    }
    const bucketName = pathSegments[publicSegmentIndex + 1];
    const filePath = decodeURIComponent(pathSegments.slice(publicSegmentIndex + 2).join('/'));
    if (!bucketName || !filePath) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
    }
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) {
        throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    }
    return data;
}

function invokeNextStep(supabase: SupabaseClient, functionName: string, payload: object) {
  supabase.functions.invoke(functionName, {
    body: payload
  }).catch((err)=>{
    console.error(`[invokeNextStep] Error invoking ${functionName}:`, err);
  });
}