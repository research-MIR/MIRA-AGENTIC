import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createCanvas, loadImage } from "https://deno.land/x/canvas@v1.4.1/mod.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GENERATED_IMAGES_BUCKET = "mira-generations";
const JPEG_QUALITY = parseFloat(Deno.env.get("JPEG_QUALITY") ?? "0.9"); // 0..1

async function standardizeImageBuffer(buffer: Uint8Array): Promise<Uint8Array> {
    const image = await Image.decode(buffer);
    return await image.encode(0); // PNG
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Invalid Supabase storage URL format: ${publicUrl}`);
    }
    const bucket = pathSegments[objectSegmentIndex + 2];
    const path = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) throw new Error(`Failed to download from Supabase storage (${path}): ${error.message}`);
    return data;
}

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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  
  const { job_id, final_image_url, job_type = "bitstudio" } = await req.json();
  if (!job_id || !final_image_url) throw new Error("job_id and final_image_url are required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[Compositor-Inpaint][${job_id}]`;
  console.log(`${logPrefix} Job started. Type: ${job_type}`);
  
  const tableName = job_type === "bitstudio" ? "mira-agent-bitstudio-jobs" : "mira-agent-inpainting-jobs";

  try {
    const { data: job, error: fetchError } = await supabase.from(tableName).select("metadata, user_id").eq("id", job_id).single();
    if (fetchError) throw fetchError;

    const metadata = job.metadata || {};
    const { full_source_image_url, bbox, final_mask_url } = metadata;

    if (!full_source_image_url || !bbox || !final_mask_url) {
      throw new Error("Job is missing essential metadata (source image, bbox, or mask) for compositing.");
    }

    console.log(`${logPrefix} Downloading assets...`);
    const [sourceBlob, inpaintedPatchResponse, maskBlob] = await Promise.all([
        downloadFromSupabase(supabase, full_source_image_url),
        fetch(final_image_url),
        downloadFromSupabase(supabase, final_mask_url)
    ]);

    if (!inpaintedPatchResponse.ok) throw new Error(`Failed to download inpainted patch: ${inpaintedPatchResponse.statusText}`);
    const inpaintedPatchBlob = await inpaintedPatchResponse.blob();
    const vtoned_crop_url = await uploadBufferToStorage(supabase, new Uint8Array(await inpaintedPatchBlob.arrayBuffer()), job.user_id, 'vtoned_crop.png');

    const [fullSourceImage, inpaintedCropImage, fullMaskImage] = await Promise.all([
        loadImage(await standardizeImageBuffer(new Uint8Array(await sourceBlob.arrayBuffer()))),
        loadImage(await standardizeImageBuffer(new Uint8Array(await inpaintedPatchBlob.arrayBuffer()))),
        loadImage(await standardizeImageBuffer(new Uint8Array(await maskBlob.arrayBuffer())))
    ]);

    const croppedMaskCanvas = createCanvas(bbox.width, bbox.height);
    const croppedMaskCtx = croppedMaskCanvas.getContext('2d');
    croppedMaskCtx.drawImage(fullMaskImage, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);

    const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
    const ctx = canvas.getContext('2d');
    ctx.drawImage(fullSourceImage, 0, 0);

    const featheredCropCanvas = createCanvas(bbox.width, bbox.height);
    const featheredCtx = featheredCropCanvas.getContext('2d');
    featheredCtx.drawImage(inpaintedCropImage, 0, 0, bbox.width, bbox.height);
    featheredCtx.globalCompositeOperation = 'destination-in';
    const featherAmount = Math.max(5, Math.round(bbox.width * 0.05));
    featheredCtx.filter = `blur(${featherAmount}px)`;
    featheredCtx.drawImage(croppedMaskCanvas, 0, 0, bbox.width, bbox.height);
    
    const feathered_patch_url = await uploadBufferToStorage(supabase, featheredCropCanvas.toBuffer('image/png'), job.user_id, 'feathered_patch.png');

    ctx.drawImage(featheredCropCanvas, bbox.x, bbox.y);

    const finalImageBuffer = canvas.toBuffer('image/jpeg', { quality: JPEG_QUALITY });
    const finalFilePath = `${job.user_id}/vto-final/${Date.now()}_final_composite.jpg`;
    const { error: uploadError } = await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(finalFilePath, finalImageBuffer, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw uploadError;

    const { data: { publicUrl: finalPublicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);
    console.log(`${logPrefix} Composition complete. Final URL: ${finalPublicUrl}`);

    let verificationResult = null;
    if (job.metadata?.reference_image_url) {
      console.log(`${logPrefix} Triggering verification tool...`);
      const { data, error } = await supabase.functions.invoke("MIRA-AGENT-tool-verify-garment-match", {
        body: {
          original_garment_url: job.metadata.reference_image_url,
          final_generated_url: finalPublicUrl
        }
      });
      if (error) {
        console.error(`${logPrefix} Verification tool failed: ${error.message}`);
        verificationResult = { error: error.message, is_match: false };
      } else {
        verificationResult = data;
      }
    }

    const finalMetadata = {
        ...job.metadata,
        verification_result: verificationResult,
        debug_assets: {
            ...job.metadata.debug_assets,
            vtoned_crop_url,
            feathered_patch_url,
            compositing_bbox: bbox,
        }
    };

    if (verificationResult && verificationResult.is_match === false) {
      console.log(`${logPrefix} QA failed -> 'awaiting_fix'. Invoking fixer orchestrator.`);
      const qaHistory = job.metadata?.qa_history || [];
      const newQaReportObject = {
        timestamp: new Date().toISOString(),
        report: verificationResult,
        failed_image_url: finalPublicUrl
      };
      await supabase.from(tableName).update({
        status: "awaiting_fix",
        metadata: { ...finalMetadata, qa_history: [...qaHistory, newQaReportObject] }
      }).eq("id", job_id);
      supabase.functions.invoke("MIRA-AGENT-fixer-orchestrator", {
        body: {
          job_id,
          qa_report_object: newQaReportObject
        }
      }).catch(console.error);
      console.log(`${logPrefix} Fixer orchestrator invoked.`);
    } else {
      console.log(`${logPrefix} QA passed/skipped. Finalizing job.`);
      const updatePayload: any = {
        status: "complete",
        final_image_url: finalPublicUrl,
        metadata: finalMetadata
      };
      if (tableName === "mira-agent-inpainting-jobs") {
        updatePayload.final_result = { publicUrl: finalPublicUrl };
        delete updatePayload.final_image_url;
      }
      await supabase.from(tableName).update(updatePayload).eq("id", job_id);
    }
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from(tableName).update({
      status: "failed",
      error_message: `Compositor failed: ${error.message}`
    }).eq("id", job_id);
    const { data: failedJob } = await supabase.from(tableName).select("metadata").eq("id", job_id).single();
    if (failedJob?.metadata?.batch_pair_job_id) {
      console.log(`${logPrefix} Propagating failure to parent pair job: ${failedJob.metadata.batch_pair_job_id}`);
      await supabase.from("mira-agent-batch-inpaint-pair-jobs").update({
        status: "failed",
        error_message: `Compositor failed: ${error.message}`
      }).eq("id", failedJob.metadata.batch_pair_job_id);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});