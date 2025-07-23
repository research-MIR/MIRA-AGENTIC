import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const GENERATED_IMAGES_BUCKET = "mira-generations";
// ---- Feather & output tunables ------------------------------------------------
const FEATHER_RATIO = parseFloat(Deno.env.get("FEATHER_RATIO") ?? "1.5"); // 3% of min dim
const FEATHER_MIN_PX = parseInt(Deno.env.get("FEATHER_MIN_PX") ?? "3", 10);
const FEATHER_MAX_PX = parseInt(Deno.env.get("FEATHER_MAX_PX") ?? "64", 10);
const JPEG_QUALITY = parseFloat(Deno.env.get("JPEG_QUALITY") ?? "0.9"); // 0..1
// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
const clamp = (v, min, max)=>Math.min(Math.max(v, min), max);
/** Ensure we have a PNG/alpha-backed Image (JPEGs decode fine but this forces a clean RGBA buffer). */ async function toPNG(img) {
  const buf = await img.encode(0); // PNG, compression 0
  return await Image.decode(buf);
}
/** Sample alpha distribution for logs */ function calcAlphaStats(img, step = 50) {
  const total = img.width * img.height;
  let sampled = 0, opaque = 0, transparent = 0, soft = 0;
  const data = img.bitmap;
  for(let i = 0; i < total; i += step){
    const a = data[i * 4 + 3];
    sampled++;
    if (a === 0) transparent++;
    else if (a === 255) opaque++;
    else soft++;
  }
  const pct = (n)=>n / sampled * 100;
  return {
    opaquePct: pct(opaque),
    softPct: pct(soft),
    transparentPct: pct(transparent),
    sampled,
    total
  };
}
/**
 * Feather the patch by reducing alpha near its rectangular edge.
 * Linear falloff: alpha *= dist/r inside the radius.
 */ function featherPatchAlpha(patch, ratio = FEATHER_RATIO, minPx = FEATHER_MIN_PX, maxPx = FEATHER_MAX_PX, logPrefix = "") {
  const w = patch.width, h = patch.height;
  let r = clamp(Math.round(Math.min(w, h) * ratio), minPx, maxPx);
  r = clamp(r, 1, Math.floor(Math.min(w, h) / 2) - 1);
  const out = patch.clone();
  const data = out.bitmap;
  let touched = 0;
  for(let y = 0; y < h; y++){
    const dy = Math.min(y, h - 1 - y);
    for(let x = 0; x < w; x++){
      const dx = Math.min(x, w - 1 - x);
      const dist = Math.min(dx, dy);
      if (dist < r) {
        const idx = (y * w + x) * 4 + 3; // alpha index
        const origA = data[idx];
        const factor = dist / r; // 0 at edge → 1 inside
        const newA = Math.round(origA * factor);
        if (newA !== origA) {
          data[idx] = newA;
          touched++;
        }
      }
    }
  }
  console.log(`${logPrefix} Feather radius=${r}px (ratio=${ratio}), patch=${w}x${h}, touched=${touched}px`);
  const stats = calcAlphaStats(out);
  console.log(`${logPrefix} Alpha stats -> opaque=${stats.opaquePct.toFixed(1)}% soft=${stats.softPct.toFixed(1)}% transparent=${stats.transparentPct.toFixed(1)}% (sampled ${stats.sampled}/${stats.total})`);
  return {
    softPatch: out,
    radius: r
  };
}
async function downloadFromSupabase(supabase, publicUrl) {
  const url = new URL(publicUrl);
  const segs = url.pathname.split("/");
  const i = segs.indexOf("public");
  if (i === -1 || i + 1 >= segs.length) {
    throw new Error(`Could not parse bucket name from URL: ${publicUrl}`);
  }
  const bucketName = segs[i + 1];
  const filePath = decodeURIComponent(segs.slice(i + 2).join("/"));
  if (!bucketName || !filePath) {
    throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
  }
  console.log(`[Downloader] bucket='${bucketName}' path='${filePath}'`);
  const { data, error } = await supabase.storage.from(bucketName).download(filePath);
  if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
  return data;
}
// -----------------------------------------------------------------------------
// Main handler
// -----------------------------------------------------------------------------
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: corsHeaders
  });
  const { job_id, final_image_url, job_type = "bitstudio" } = await req.json();
  if (!job_id || !final_image_url) throw new Error("job_id and final_image_url are required.");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const logPrefix = `[Compositor-Inpaint][${job_id}]`;
  console.log(`${logPrefix} Job started. Type: ${job_type}`);
  const tableName = job_type === "bitstudio" ? "mira-agent-bitstudio-jobs" : "mira-agent-inpainting-jobs";
  try {
    const { data: job, error: fetchError } = await supabase.from(tableName).select("metadata, user_id").eq("id", job_id).single();
    if (fetchError) throw fetchError;
    const metadata = job.metadata || {};
    const { full_source_image_url, bbox } = metadata;
    if (!full_source_image_url || !bbox) {
      console.warn(`${logPrefix} Missing metadata (full_source_image_url or bbox). Legacy job -> skip composition.`);
      await supabase.from(tableName).update({
        status: "complete",
        final_image_url: final_image_url
      }).eq("id", job_id);
      return new Response(JSON.stringify({
        success: true,
        message: "Legacy job finalized without composition."
      }), {
        headers: corsHeaders
      });
    }
    console.log(`${logPrefix} Downloading assets...`);
    console.log(`${logPrefix} Source URL: ${full_source_image_url}`);
    console.log(`${logPrefix} Patch URL : ${final_image_url}`);
    const [sourceBlob, inpaintedPatchResponse] = await Promise.all([
      downloadFromSupabase(supabase, full_source_image_url),
      fetch(final_image_url)
    ]);
    if (!inpaintedPatchResponse.ok) throw new Error(`Failed to download inpainted patch: ${inpaintedPatchResponse.statusText}`);
    const [sourceImage, origPatch] = await Promise.all([
      Image.decode(await sourceBlob.arrayBuffer()),
      Image.decode(await inpaintedPatchResponse.arrayBuffer())
    ]);
    // Guarantee RGBA/alpha-friendly patch
    const inpaintedPatchImg = await toPNG(origPatch);
    console.log(`${logPrefix} Compositing with feathering...`);
    const { softPatch, radius } = featherPatchAlpha(inpaintedPatchImg, FEATHER_RATIO, FEATHER_MIN_PX, FEATHER_MAX_PX, logPrefix);
    sourceImage.composite(softPatch, bbox.x, bbox.y);
    console.log(`${logPrefix} Patch composited at (${bbox.x}, ${bbox.y}) with radius=${radius}px.`);
    // Final encode as JPEG
    const qualityInt = Math.round(JPEG_QUALITY * 100);
    const finalImageBuffer = await sourceImage.encodeJPEG(qualityInt);
    const finalFilePath = `${job.user_id}/vto-final/${Date.now()}_final_composite.jpg`;
    const { error: uploadError } = await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(finalFilePath, finalImageBuffer, {
      contentType: "image/jpeg",
      upsert: true
    });
    if (uploadError) throw uploadError;
    const { data: { publicUrl: finalPublicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);
    console.log(`${logPrefix} Composition complete. Final URL: ${finalPublicUrl}`);
    // ---- Optional verification step -----------------------------------------
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
        verificationResult = {
          error: error.message,
          is_match: false
        };
      } else {
        verificationResult = data;
      }
    }
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
        metadata: {
          ...job.metadata,
          qa_history: [
            ...qaHistory,
            newQaReportObject
          ]
        }
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
      const finalMetadata = {
        ...job.metadata,
        verification_result: verificationResult
      };
      const updatePayload = {
        status: "complete",
        final_image_url: finalPublicUrl,
        metadata: finalMetadata
      };
      if (tableName === "mira-agent-inpainting-jobs") {
        updatePayload.final_result = {
          publicUrl: finalPublicUrl
        };
        delete updatePayload.final_image_url;
      }
      await supabase.from(tableName).update(updatePayload).eq("id", job_id);
    }
    return new Response(JSON.stringify({
      success: true
    }), {
      headers: corsHeaders
    });
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
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      },
      status: 500
    });
  }
});
