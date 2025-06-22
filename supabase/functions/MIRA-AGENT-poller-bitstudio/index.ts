import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';
const POLLING_INTERVAL_MS = 3000; // 3 seconds
const GENERATED_IMAGES_BUCKET = 'mira-generations';

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array | null, userId: string, filename: string, jobId: string): Promise<string | null> {
    if (!buffer) {
        console.log(`[BitStudioPoller-V2][${jobId}] Skipping upload for ${filename} as buffer is null.`);
        return null;
    }
    const filePath = `${userId}/vto-debug/${Date.now()}-${filename}`;
    console.log(`[BitStudioPoller-V2][${jobId}] Uploading ${filename} to ${filePath}...`);
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) {
        console.error(`[BitStudioPoller-V2][${jobId}] Storage upload failed for ${filename}: ${error.message}`);
        return null;
    }
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    console.log(`[BitStudioPoller-V2][${jobId}] Upload successful for ${filename}.`);
    return publicUrl;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[BitStudioPoller-V2][${job_id}] Invoked to check status.`);

  try {
    await supabase.from('mira-agent-bitstudio-jobs').update({ last_polled_at: new Date().toISOString() }).eq('id', job_id);
    console.log(`[BitStudioPoller-V2][${job_id}] Heartbeat updated.`);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    console.log(`[BitStudioPoller-V2][${job_id}] Fetched job from DB. Current status: ${job.status}, mode: ${job.mode}`);
    
    if (job.status === 'complete' || job.status === 'failed') {
        console.log(`[BitStudioPoller-V2][${job.id}] Job already resolved. Halting check.`);
        return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const taskId = job.bitstudio_task_id;
    const statusUrl = `${BITSTUDIO_API_BASE}/images/${taskId}`;
    console.log(`[BitStudioPoller-V2][${job.id}] Fetching status from BitStudio: ${statusUrl}`);
    const statusResponse = await fetch(statusUrl, {
      headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` }
    });

    if (!statusResponse.ok) throw new Error(`BitStudio status check failed: ${await statusResponse.text()}`);
    const statusData = await statusResponse.json();
    console.log(`[BitStudioPoller-V2][${job.id}] Received status data from BitStudio:`, JSON.stringify(statusData, null, 2));
    
    let jobStatus, finalImageUrl;

    if (job.mode === 'inpaint') {
        const versionIdToFind = job.metadata?.bitstudio_version_id;
        if (!versionIdToFind) throw new Error("Job is missing the version ID in its metadata.");
        const targetVersion = statusData.versions?.find((v: any) => v.id === versionIdToFind);
        if (!targetVersion) throw new Error(`Could not find version ${versionIdToFind} in the base image's version list.`);
        jobStatus = targetVersion.status;
        finalImageUrl = targetVersion.path;
    } else {
        jobStatus = statusData.status;
        finalImageUrl = statusData.path;
    }
    console.log(`[BitStudioPoller-V2][${job.id}] Determined BitStudio status: ${jobStatus}`);

    if (jobStatus === 'completed') {
      console.log(`[BitStudioPoller-V2][${job.id}] Status is 'completed'.`);
      
      if (job.mode === 'inpaint') {
        console.log(`[BitStudioPoller-V2][${job.id}] Inpaint job complete. Starting composition...`);
        
        const metadata = job.metadata || {};
        if (!metadata.full_source_image_base64 || !metadata.bbox) {
          console.error(`[BitStudioPoller-V2][${job.id}] CRITICAL ERROR: Missing essential metadata for composition.`);
          throw new Error("Job is missing essential metadata (full source image or bounding box) for compositing.");
        }
        console.log(`[BitStudioPoller-V2][${job.id}] Metadata validated.`);
        
        console.log(`[BitStudioPoller-V2][${job.id}] Loading full source image from base64...`);
        const fullSourceImage = await loadImage(`data:image/png;base64,${job.metadata.full_source_image_base64}`);
        console.log(`[BitStudioPoller-V2][${job.id}] Downloading inpainted crop from BitStudio URL: ${finalImageUrl}`);
        const inpaintedCropResponse = await fetch(finalImageUrl);
        if (!inpaintedCropResponse.ok) throw new Error("Failed to download inpainted crop from BitStudio.");
        
        const inpaintedCropArrayBuffer = await inpaintedCropResponse.arrayBuffer();
        console.log(`[BitStudioPoller-V2][${job.id}] Loading inpainted crop into memory...`);
        const inpaintedCropImage = await loadImage(new Uint8Array(inpaintedCropArrayBuffer));
        console.log(`[BitStudioPoller-V2][${job.id}] All images loaded successfully.`);

        const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
        const ctx = canvas.getContext('2d');
        console.log(`[BitStudioPoller-V2][${job.id}] Drawing full source image onto canvas...`);
        ctx.drawImage(fullSourceImage, 0, 0);
        
        console.log(`[BitStudioPoller-V2][${job.id}] Drawing inpainted crop onto canvas at bbox:`, JSON.stringify(job.metadata.bbox));
        ctx.drawImage(inpaintedCropImage, job.metadata.bbox.x, job.metadata.bbox.y, job.metadata.bbox.width, job.metadata.bbox.height);
        
        console.log(`[BitStudioPoller-V2][${job.id}] Generating final composited image buffer...`);
        const finalImageBuffer = canvas.toBuffer('image/png');
        console.log(`[BitStudioPoller-V2][${job.id}] Preparing debug asset buffers...`);
        const croppedSourceBuffer = metadata.cropped_source_image_base64 ? decodeBase64(metadata.cropped_source_image_base64) : null;
        const dilatedMaskBuffer = metadata.cropped_dilated_mask_base64 ? decodeBase64(metadata.cropped_dilated_mask_base64) : null;
        const inpaintedCropBuffer = new Uint8Array(inpaintedCropArrayBuffer);

        console.log(`[BitStudioPoller-V2][${job.id}] Uploading all assets in parallel...`);
        const [
            finalCompositedUrl,
            croppedSourceUrl,
            dilatedMaskUrl,
            inpaintedCropUrl
        ] = await Promise.all([
            uploadBufferToStorage(supabase, finalImageBuffer, job.user_id, 'final_composite.png', job.id),
            uploadBufferToStorage(supabase, croppedSourceBuffer, job.user_id, 'cropped_source.png', job.id),
            uploadBufferToStorage(supabase, dilatedMaskBuffer, job.user_id, 'dilated_mask.png', job.id),
            uploadBufferToStorage(supabase, inpaintedCropBuffer, job.user_id, 'inpainted_crop.png', job.id)
        ]);

        if (!finalCompositedUrl) {
            throw new Error("Failed to upload the final composited image to storage.");
        }
        console.log(`[BitStudioPoller-V2][${job.id}] All assets uploaded.`);

        const debug_assets = {
            cropped_source_url: croppedSourceUrl,
            dilated_mask_url: dilatedMaskUrl,
            inpainted_crop_url: inpaintedCropUrl,
            final_composited_url: finalCompositedUrl
        };

        console.log(`[BitStudioPoller-V2][${job.id}] Updating final job record in database...`);
        await supabase.from('mira-agent-bitstudio-jobs')
          .update({ 
              final_image_url: finalCompositedUrl,
              status: 'complete',
              metadata: { ...job.metadata, debug_assets }
          })
          .eq('id', job_id);
        console.log(`[BitStudioPoller-V2][${job.id}] Database update complete. Notifying UI.`);

      } else {
        console.log(`[BitStudioPoller-V2][${job.id}] VTO job complete. Finalizing...`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
          status: 'complete',
          final_image_url: finalImageUrl,
        }).eq('id', job_id);
      }
      console.log(`[BitStudioPoller-V2][${job.id}] Polling finished for this cycle.`);

    } else if (jobStatus === 'failed') {
      console.error(`[BitStudioPoller-V2][${job.id}] Status is 'failed'. Updating job with error.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'failed',
        error_message: 'BitStudio processing failed.',
      }).eq('id', job_id);
    } else {
      console.log(`[BitStudioPoller-V2][${job.id}] Status is '${jobStatus}'. Re-polling in ${POLLING_INTERVAL_MS}ms.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'processing' }).eq('id', job_id);
      setTimeout(() => {
        supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id } }).catch(console.error);
      }, POLLING_INTERVAL_MS);
    }

    return new Response(JSON.stringify({ success: true, status: jobStatus }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[BitStudioPoller-V2][${job_id}] Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});