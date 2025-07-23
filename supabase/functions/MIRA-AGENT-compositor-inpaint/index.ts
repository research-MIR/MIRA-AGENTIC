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
  console.log(`${logPrefix} Job started. Type: ${job_type}`);

  const tableName = job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs';

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
        console.warn(`${logPrefix} Job is missing metadata for compositing (full_source_image_url or bbox). Assuming it's a legacy job and skipping composition.`);
        await supabase.from(tableName).update({ status: 'complete', final_image_url: final_image_url }).eq('id', job_id);
        return new Response(JSON.stringify({ success: true, message: "Legacy job finalized without composition." }), { headers: corsHeaders });
    }

    console.log(`${logPrefix} Downloading assets for composition...`);
    const [sourceBlob, inpaintedPatchResponse] = await Promise.all([
        downloadFromSupabase(supabase, full_source_image_url),
        fetch(final_image_url)
    ]);

    if (!inpaintedPatchResponse.ok) throw new Error(`Failed to download inpainted patch: ${inpaintedPatchResponse.statusText}`);

    // --- Generate and Upload New Debug Assets ---
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
        console.log(`${logPrefix} Generated and uploaded compositing debug assets.`);
    }
    // --- End Debug Asset Generation ---

    console.log(`${logPrefix} Compositing final image...`);
    
    // --- Refactored Compositing Logic using deno-canvas for decoding and imagescript for encoding ---
    const sourceImage = await loadImage(new Uint8Array(await sourceBlob.arrayBuffer()));
    const inpaintedPatchImg = await loadImage(new Uint8Array(await inpaintedPatchResponse.arrayBuffer()));
    console.log(`${logPrefix} Decoded images. Source: ${sourceImage.width()}x${sourceImage.height()}, Patch: ${inpaintedPatchImg.width()}x${inpaintedPatchImg.height()}`);

    const canvas = createCanvas(sourceImage.width(), sourceImage.height());
    const ctx = canvas.getContext('2d');
    ctx.drawImage(sourceImage, 0, 0);

    const featheredCropCanvas = createCanvas(bbox.width, bbox.height);
    const featheredCtx = featheredCropCanvas.getContext('2d');
    featheredCtx.drawImage(inpaintedPatchImg, 0, 0, bbox.width, bbox.height);
    
    if (croppedMaskImage) {
        featheredCtx.globalCompositeOperation = 'destination-in';
        const featherAmount = Math.max(5, Math.round(bbox.width * 0.05));
        featheredCtx.filter = `blur(${featherAmount}px)`;
        featheredCtx.drawImage(croppedMaskImage, 0, 0, bbox.width, bbox.height);
    }

    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    console.log(`${logPrefix} Drawing feathered patch at x:${bbox.x}, y:${bbox.y} with size ${bbox.width}x${bbox.height}`);
    ctx.drawImage(featheredCropCanvas, bbox.x, bbox.y);
    
    const finalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const finalImage = new Image(canvas.width, canvas.height, finalImageData.data);
    const finalImageBuffer = await finalImage.encode(0); // Use stable imagescript encoder

    console.log(`${logPrefix} Final image buffer created. Size: ${(finalImageBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    const finalFilePath = `${job.user_id}/vto-final/${Date.now()}_final_composite.png`;
    
    const { error: uploadError } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(finalFilePath, finalImageBuffer, { contentType: 'image/png', upsert: true });
    if (uploadError) throw uploadError;

    const { data: { publicUrl: finalPublicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);
    console.log(`${logPrefix} Composition complete. Final URL: ${finalPublicUrl}`);

    let verificationResult = null;
    if (job.metadata?.reference_image_url) {
        console.log(`${logPrefix} Reference image found. Triggering verification step.`);
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-verify-garment-match', {
            body: {
                original_garment_url: job.metadata.reference_image_url,
                final_generated_url: finalPublicUrl
            }
        });
        if (error) {
            console.error(`${logPrefix} Verification tool failed:`, error.message);
            verificationResult = { error: error.message, is_match: false };
        } else {
            verificationResult = data;
        }
        console.log(`${logPrefix} Verification result: is_match=${verificationResult?.is_match}`);
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
        console.log(`${logPrefix} QA failed. Setting status to 'awaiting_fix' and invoking orchestrator.`);
        const qaHistory = job.metadata?.qa_history || [];
        
        const newQaReportObject = { 
            timestamp: new Date().toISOString(), 
            report: verificationResult,
            failed_image_url: finalPublicUrl
        };

        await supabase.from(tableName).update({ 
            status: 'awaiting_fix',
            metadata: { ...finalMetadata, qa_history: [...qaHistory, newQaReportObject] }
        }).eq('id', job_id);

        supabase.functions.invoke('MIRA-AGENT-fixer-orchestrator', { 
            body: { 
                job_id,
                qa_report_object: newQaReportObject 
            } 
        }).catch(console.error);
        console.log(`${logPrefix} Fixer orchestrator invoked for job.`);

    } else {
        console.log(`${logPrefix} QA passed or was skipped. Finalizing job as complete.`);
        
        const updatePayload: any = { 
            status: 'complete', 
            final_image_url: finalPublicUrl, 
            metadata: finalMetadata 
        };

        if (tableName === 'mira-agent-inpainting-jobs') {
            updatePayload.final_result = { publicUrl: finalPublicUrl };
            delete updatePayload.final_image_url;
        }

        await supabase.from(tableName).update(updatePayload).eq('id', job_id);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from(tableName).update({ status: 'failed', error_message: `Compositor failed: ${error.message}` }).eq('id', job_id);
    
    const { data: failedJob } = await supabase.from(tableName).select('metadata').eq('id', job_id).single();
    if (failedJob?.metadata?.batch_pair_job_id) {
        console.log(`${logPrefix} Propagating failure to parent pair job: ${failedJob.metadata.batch_pair_job_id}`);
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

    console.log(`[Downloader] Attempting to download from bucket: '${bucketName}', path: '${filePath}'`);

    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) {
        throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    }
    return data;
}