import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import sharp from "npm:sharp@0.33.4";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const isMostlyBlack = (buf: Uint8Array) => {
  if (!buf || buf.length < 1000) return true; // Invalid buffer
  let nonZero = 0;
  for (let i = 0; i < Math.min(buf.length, 1000); i++) {
    if (buf[i] > 1) { nonZero++; if (nonZero > 10) return false; }
  }
  return true;
};

const encodeToJpegWithFallback = async (canvas: any, logPrefix: string, label: string): Promise<Uint8Array> => {
    const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    
    // Primary Method: ImageScript
    console.log(`${logPrefix} Attempting JPEG encoding for '${label}' with ImageScript...`);
    const imageScript = new ISImage(imageData.width, imageData.height, imageData.data);
    let buffer = await imageScript.encodeJPEG(90);

    if (isMostlyBlack(buffer)) {
        console.warn(`${logPrefix} ⚠️ ImageScript produced a suspect (mostly black) JPEG for '${label}'. Trying fallback with sharp.`);
        
        // Fallback Method: Sharp
        buffer = await sharp(imageData.data, {
            raw: {
                width: canvas.width,
                height: canvas.height,
                channels: 4
            }
        }).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();

        if (isMostlyBlack(buffer)) {
            console.error(`${logPrefix} 🚨 CRITICAL: Fallback encoder (sharp) also produced a black JPEG for '${label}'.`);
            throw new Error(`All encoders failed for '${label}', likely due to a corrupt canvas state.`);
        }
        console.log(`${logPrefix} ✅ Fallback encoder (sharp) for '${label}' succeeded.`);
    } else {
        console.log(`${logPrefix} ✅ Primary encoder (ImageScript) for '${label}' succeeded.`);
    }

    return buffer;
};

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

    let { context } = job;
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
      
      const originalImage = await loadImage(new Uint8Array(await blob.arrayBuffer()));
      const originalW = originalImage.width();
      const originalH = originalImage.height();
      
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
      
      const maskBuffer = await encodeToJpegWithFallback(maskCanvas, logPrefix, 'mask');

      const newBaseCanvas = createCanvas(newW, newH);
      const newBaseCtx = newBaseCanvas.getContext('2d');
      newBaseCtx.fillStyle = 'white';
      newBaseCtx.fillRect(0, 0, newW, newH);
      newBaseCtx.drawImage(originalImage, xOffset, yOffset);
      
      const newBaseBuffer = await encodeToJpegWithFallback(newBaseCanvas, logPrefix, 'base');

      const uploadFile = async (buffer: Uint8Array, filename: string, contentType: string) => {
        const filePath = `${job.user_id}/reframe-generated/${job_id}-${filename}`;
        const { data: uploadData, error: uploadError } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, buffer, { contentType });
        if (uploadError) throw new Error(`Supabase storage upload failed for ${filename}: ${uploadError.message}`);
        const { data: urlData } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
        if (!urlData || !urlData.publicUrl) throw new Error(`Failed to get public URL for uploaded file: ${filePath}`);
        return urlData.publicUrl;
      };

      [final_base_url, final_mask_url] = await Promise.all([
        uploadFile(newBaseBuffer, 'base.jpeg', 'image/jpeg'),
        uploadFile(maskBuffer, 'mask.jpeg', 'image/jpeg')
      ]);
      
      await supabase.from('mira-agent-jobs').update({
        context: { ...context, base_image_url: final_base_url, mask_image_url: final_mask_url }
      }).eq('id', job_id);
      context = { ...context, base_image_url: final_base_url, mask_image_url: final_mask_url };
    } else {
      console.log(`${logPrefix} Pre-made mask found. Bypassing canvas generation.`);
    }

    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-auto-describe-scene', {
        body: {
            base_image_base64: (await blobToBase64(await downloadImageAsBlob(supabase, final_base_url))),
            user_hint: context.prompt || "",
            mime_type: 'image/jpeg'
        }
    });
    if (promptError) throw new Error(`Auto-describe-scene tool failed: ${promptError.message}`);
    const finalPrompt = promptData.scene_prompt;
    console.log(`${logPrefix} Generated intelligent prompt: "${finalPrompt}"`);

    await supabase.from('mira-agent-jobs').update({
        context: { ...context, final_prompt_used: finalPrompt }
    }).eq('id', job_id);

    const { error: reframeError } = await supabase.functions.invoke('MIRA-AGENT-tool-reframe-image', {
      body: { job_id, prompt: finalPrompt }
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

async function downloadImageAsBlob(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathPrefix = `/storage/v1/object/public/${UPLOAD_BUCKET}/`;
    const filePath = decodeURIComponent(url.pathname.substring(pathPrefix.length));
    const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath);
    if (error) throw new Error(`Failed to download image from storage: ${error.message}`);
    return data;
}