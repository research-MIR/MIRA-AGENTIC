import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize the Supabase client once per isolate lifecycle to save CPU time on cold starts.
const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");
  
  const logPrefix = `[ReframeOrchestrator][${job_id}]`;

  try {
    console.log(`${logPrefix} Starting orchestration.`);
    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('context, user_id').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const { context } = job;
    let final_base_url = context.base_image_url;
    let final_mask_url = context.mask_image_url;

    if (!final_mask_url) {
      console.log(`${logPrefix} No pre-made mask found. Generating new canvas and mask.`);
      const { base_image_url, aspect_ratio } = context;
      if (!base_image_url || !aspect_ratio) throw new Error("Missing base_image_url or aspect_ratio for mask generation.");

      const url = new URL(base_image_url);
      const pathPrefix = `/storage/v1/object/public/${UPLOAD_BUCKET}/`;
      const imagePath = decodeURIComponent(url.pathname.substring(pathPrefix.length));
      const { data: blob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(imagePath);
      if (downloadError) throw new Error(`Failed to download base image: ${downloadError.message}`);
      
      console.log(`${logPrefix} Downloaded original image blob. Size: ${blob.size}, Type: ${blob.type}`);

      const originalImage = await loadImage(new Uint8Array(await blob.arrayBuffer()));
      const originalW = originalImage.width();
      const originalH = originalImage.height();
      
      console.log(`${logPrefix} Loaded original image. Dimensions: ${originalW}x${originalH}`);

      const [targetW, targetH] = aspect_ratio.split(':').map(Number);
      const targetRatio = targetW / targetH;
      const originalRatio = originalW / originalH;

      let newW, newH;
      if (targetRatio > originalRatio) {
        newW = Math.round(originalH * targetRatio);
        newH = originalH;
      } else {
        newH = Math.round(originalW / targetRatio);
        newW = originalW;
      }
      
      console.log(`${logPrefix} Calculated new canvas dimensions: ${newW}x${newH}`);

      const xOffset = (newW - originalW) / 2;
      const yOffset = (newH - originalH) / 2;

      const maskCanvas = createCanvas(newW, newH);
      const maskCtx = maskCanvas.getContext('2d');
      maskCtx.fillStyle = 'white';
      maskCtx.fillRect(0, 0, newW, newH);
      
      const featherAmount = Math.min(Math.max(2, Math.round(Math.min(originalW, originalH) * 0.005)), 48);
      
      maskCtx.fillStyle = 'black';
      maskCtx.shadowColor = 'black';
      maskCtx.shadowBlur = featherAmount;
      maskCtx.fillRect(xOffset, yOffset, originalW, originalH);
      
      const maskImageData = maskCtx.getImageData(0, 0, newW, newH);
      const maskImageScript = new ISImage(maskImageData.width, maskImageData.height, maskImageData.data);
      const maskBuffer = await maskImageScript.encode(0); // Encode as PNG (lossless)
      console.log(`${logPrefix} Generated mask buffer using imagescript. Length: ${maskBuffer.length}`);
      if (maskBuffer.length === 0) {
          throw new Error("FATAL: Generated mask buffer is empty. ImageScript operation failed.");
      }

      const newBaseCanvas = createCanvas(newW, newH);
      const newBaseCtx = newBaseCanvas.getContext('2d');
      newBaseCtx.fillStyle = 'white';
      newBaseCtx.fillRect(0, 0, newW, newH);
      newBaseCtx.drawImage(originalImage, xOffset, yOffset);
      
      const newBaseImageData = newBaseCtx.getImageData(0, 0, newW, newH);
      const newBaseImageScript = new ISImage(newBaseImageData.width, newBaseImageData.height, newBaseImageData.data);
      const newBaseBuffer = await newBaseImageScript.encodeJPEG(90); // Base image can be JPEG
      console.log(`${logPrefix} Generated new base image buffer using imagescript. Length: ${newBaseBuffer.length}`);
      if (newBaseBuffer.length === 0) {
          throw new Error("FATAL: Generated base image buffer is empty. ImageScript operation failed.");
      }

      const uploadFile = async (buffer: Uint8Array, filename: string, contentType: string) => {
        const filePath = `${job.user_id}/reframe-generated/${job_id}-${filename}`;
        console.log(`${logPrefix} Uploading ${filename} (${buffer.length} bytes) to ${filePath}...`);
        const { data: uploadData, error: uploadError } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, buffer, { contentType });
        if (uploadError) {
          console.error(`${logPrefix} Supabase storage upload failed for ${filename}:`, uploadError);
          throw new Error(`Supabase storage upload failed for ${filename}: ${uploadError.message}`);
        }
        console.log(`${logPrefix} Supabase storage upload successful for ${filename}. Path: ${uploadData.path}`);
        
        const { data: urlData } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
        if (!urlData || !urlData.publicUrl) {
            console.error(`${logPrefix} Failed to get public URL for ${filePath}. URL data was null or empty.`);
            throw new Error(`Failed to get public URL for uploaded file: ${filePath}`);
        }
        console.log(`${logPrefix} Successfully got public URL for ${filename}.`);
        return urlData.publicUrl;
      };

      [final_base_url, final_mask_url] = await Promise.all([
        uploadFile(newBaseBuffer, 'base.jpeg', 'image/jpeg'),
        uploadFile(maskBuffer, 'mask.png', 'image/png')
      ]);
      
      console.log(`${logPrefix} Uploaded new assets. Base URL: ${final_base_url}, Mask URL: ${final_mask_url}`);

      await supabase.from('mira-agent-jobs').update({
        context: { ...context, base_image_url: final_base_url, mask_image_url: final_mask_url }
      }).eq('id', job_id);
      console.log(`${logPrefix} Saved new assets to storage, ready for reframe tool.`);
    } else {
      console.log(`${logPrefix} Pre-made mask found. Bypassing canvas generation.`);
    }

    console.log(`${logPrefix} Invoking final reframe tool with assets.`);
    const { error: reframeError } = await supabase.functions.invoke('MIRA-AGENT-tool-reframe-image', {
      body: { job_id, prompt: context.prompt || "" }
    });
    if (reframeError) throw new Error(`Reframe tool invocation failed: ${reframeError.message}`);

    const { data: finalJobData, error: finalFetchError } = await supabase.from('mira-agent-jobs').select('final_result, context').eq('id', job_id).single();
    if (finalFetchError) throw finalFetchError;

    const parentVtoJobId = finalJobData.context?.vto_pair_job_id;
    if (parentVtoJobId) {
      console.log(`${logPrefix} This was a VTO job. Reporting back to parent worker ${parentVtoJobId}...`);
      const finalImageUrl = finalJobData.final_result?.images?.[0]?.publicUrl;
      if (finalImageUrl) {
        const { error: callbackError } = await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
          body: { pair_job_id: parentVtoJobId, reframe_result_url: finalImageUrl }
        });
        if (callbackError) {
          console.error(`${logPrefix} Failed to report back to parent VTO worker:`, callbackError);
        } else {
          console.log(`${logPrefix} Successfully reported back to parent VTO worker.`);
        }
      } else {
        console.warn(`${logPrefix} Reframe job completed but no final image URL was found to report back to the parent VTO job.`);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', job_id);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});