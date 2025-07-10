import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    let bucketName: string;
    let filePath: string;

    const publicSegmentIndex = pathSegments.indexOf('public');
    const objectSegmentIndex = pathSegments.indexOf('object');

    if (publicSegmentIndex !== -1 && publicSegmentIndex + 1 < pathSegments.length) {
        bucketName = pathSegments[publicSegmentIndex + 1];
        filePath = pathSegments.slice(publicSegmentIndex + 2).join('/');
    } else if (objectSegmentIndex !== -1 && objectSegmentIndex + 2 < pathSegments.length) {
        bucketName = pathSegments[objectSegmentIndex + 2];
        const pathStartIndex = url.pathname.indexOf(bucketName) + bucketName.length + 1;
        filePath = decodeURIComponent(url.pathname.substring(pathStartIndex));
    } else {
        throw new Error(`Could not parse bucket name or file path from URL: ${publicUrl}`);
    }

    if (!bucketName || !filePath) {
        throw new Error(`Could not parse bucket or path from URL: ${publicUrl}`);
    }

    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) {
        throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    }
    return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id, final_image_url, job_type = 'comfyui' } = await req.json();
  if (!job_id || !final_image_url) throw new Error("job_id and final_image_url are required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[Compositor-Inpainting][${job_id}] Job started. Type: ${job_type}`);

  try {
    let job, fetchError;
    const tableName = job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs';
    const selectColumns = job_type === 'bitstudio' ? 'metadata, user_id, source_person_image_url' : 'metadata, user_id';

    console.log(`[Compositor-Inpainting][${job_id}] Fetching from table: ${tableName}`);
    
    ({ data: job, error: fetchError } = await supabase
      .from(tableName)
      .select(selectColumns)
      .eq('id', job_id)
      .single());

    if (fetchError) throw fetchError;
    
    let metadata = job.metadata || {};

    // --- FALLBACK LOGIC ---
    if (!metadata.full_source_image_base64 || !metadata.bbox || !metadata.cropped_dilated_mask_base64) {
        console.log(`[Compositor-Inpainting][${job_id}] Metadata is missing. Attempting to regenerate from source URLs.`);
        
        const sourceUrl = job_type === 'bitstudio' ? job.source_person_image_url : metadata.source_image_url;
        const maskUrl = metadata.mask_image_url;

        if (!sourceUrl || !maskUrl) {
            throw new Error("Job is missing essential metadata AND source/mask URLs for fallback regeneration.");
        }

        console.log(`[Compositor-Inpainting][${job_id}] Fallback: Downloading source from ${sourceUrl} and mask from ${maskUrl}`);
        
        const [sourceBlob, maskBlob] = await Promise.all([
            downloadFromSupabase(supabase, sourceUrl),
            downloadFromSupabase(supabase, maskUrl)
        ]);

        const fullSourceImage = await loadImage(await sourceBlob.arrayBuffer());
        const rawMaskImage = await loadImage(await maskBlob.arrayBuffer());

        const dilatedCanvas = createCanvas(rawMaskImage.width(), rawMaskImage.height());
        const dilateCtx = dilatedCanvas.getContext('2d');
        const dilationAmount = Math.max(10, Math.round(rawMaskImage.width() * 0.03));
        dilateCtx.filter = `blur(${dilationAmount}px)`;
        dilateCtx.drawImage(rawMaskImage, 0, 0);
        dilateCtx.filter = 'none';
        
        const dilatedImageData = dilateCtx.getImageData(0, 0, dilatedCanvas.width, dilatedCanvas.height);
        const data = dilatedImageData.data;
        let minX = dilatedCanvas.width, minY = dilatedCanvas.height, maxX = 0, maxY = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 128) {
                data[i] = data[i+1] = data[i+2] = 255;
                const x = (i / 4) % dilatedCanvas.width;
                const y = Math.floor((i / 4) / dilatedCanvas.width);
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            } else {
                data[i] = data[i+1] = data[i+2] = 0;
            }
        }
        dilateCtx.putImageData(dilatedImageData, 0, 0);

        if (maxX < minX || maxY < minY) throw new Error("Fallback: The provided mask is empty or invalid after processing.");

        const padding = Math.round(Math.max(maxX - minX, maxY - minY) * 0.20);
        const bbox = {
            x: Math.max(0, minX - padding),
            y: Math.max(0, minY - padding),
            width: Math.min(fullSourceImage.width(), maxX + padding) - Math.max(0, minX - padding),
            height: Math.min(fullSourceImage.height(), maxY + padding) - Math.max(0, minY - padding),
        };

        if (bbox.width <= 0 || bbox.height <= 0) throw new Error(`Fallback: Invalid bounding box dimensions: ${bbox.width}x${bbox.height}.`);

        const croppedMaskCanvas = createCanvas(bbox.width, bbox.height);
        croppedMaskCanvas.getContext('2d')!.drawImage(dilatedCanvas, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
        
        metadata.full_source_image_base64 = encodeBase64(await sourceBlob.arrayBuffer());
        metadata.bbox = bbox;
        metadata.cropped_dilated_mask_base64 = encodeBase64(croppedMaskCanvas.toBuffer('image/png'));
        
        console.log(`[Compositor-Inpainting][${job_id}] Fallback metadata successfully regenerated.`);
    }
    // --- END FALLBACK LOGIC ---

    const fullSourceImage = await loadImage(decodeBase64(metadata.full_source_image_base64));
    const inpaintedCropResponse = await fetch(final_image_url);
    if (!inpaintedCropResponse.ok) throw new Error(`Failed to download inpainted crop: ${inpaintedCropResponse.statusText}`);
    const inpaintedCropArrayBuffer = await inpaintedCropResponse.arrayBuffer();
    const inpaintedCropImage = await loadImage(new Uint8Array(inpaintedCropArrayBuffer));
    const croppedMaskBuffer = decodeBase64(metadata.cropped_dilated_mask_base64);
    const croppedMaskImage = await loadImage(croppedMaskBuffer);

    const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
    const ctx = canvas.getContext('2d');
    ctx.drawImage(fullSourceImage, 0, 0);

    const featheredCropCanvas = createCanvas(metadata.bbox.width, metadata.bbox.height);
    const featheredCtx = featheredCropCanvas.getContext('2d');
    featheredCtx.drawImage(inpaintedCropImage, 0, 0, metadata.bbox.width, metadata.bbox.height);
    featheredCtx.globalCompositeOperation = 'destination-in';
    const featherAmount = Math.max(5, Math.round(metadata.bbox.width * 0.05));
    featheredCtx.filter = `blur(${featherAmount}px)`;
    featheredCtx.drawImage(croppedMaskImage, 0, 0, metadata.bbox.width, metadata.bbox.height);

    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.drawImage(featheredCropCanvas, metadata.bbox.x, metadata.bbox.y);
    
    const finalImageBuffer = canvas.toBuffer('image/png');
    const finalFilePath = `${job.user_id}/inpainting-final/${Date.now()}_final.png`;
    
    const { error: uploadError } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(finalFilePath, finalImageBuffer, { contentType: 'image/png', upsert: true });
    if (uploadError) throw uploadError;

    const { data: { publicUrl: finalPublicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);

    let verificationResult = null;
    if (metadata.reference_image_url) {
        console.log(`[Compositor-Inpainting][${job_id}] Reference image found. Triggering verification step.`);
        try {
            const { data: verificationData, error: verificationError } = await supabase.functions.invoke('MIRA-AGENT-tool-verify-garment-match', {
                body: {
                    original_garment_url: metadata.reference_image_url,
                    final_generated_url: finalPublicUrl
                }
            });
            if (verificationError) {
                console.error(`[Compositor-Inpainting][${job_id}] Verification tool failed:`, verificationError.message);
                verificationResult = { error: verificationError.message };
            } else {
                console.log(`[Compositor-Inpainting][${job_id}] Verification successful:`, verificationData);
                verificationResult = verificationData;
            }
        } catch (e) {
            console.error(`[Compositor-Inpainting][${job_id}] Exception during verification tool invocation:`, e.message);
            verificationResult = { error: e.message };
        }
    } else {
        console.log(`[Compositor-Inpainting][${job_id}] No reference image in metadata. Skipping verification step.`);
    }

    const finalResultPayload = { publicUrl: finalPublicUrl, storagePath: finalFilePath };
    const finalMetadata = { 
        ...metadata, 
        full_source_image_base64: null, 
        cropped_dilated_mask_base64: null,
        verification_result: verificationResult
    };

    if (job_type === 'bitstudio') {
        await supabase.from('mira-agent-bitstudio-jobs')
          .update({ 
              status: 'complete',
              final_image_url: finalPublicUrl,
              metadata: finalMetadata
          })
          .eq('id', job_id);
    } else { // comfyui
        await supabase.from('mira-agent-inpainting-jobs')
          .update({ 
              status: 'complete',
              final_result: finalResultPayload,
              metadata: finalMetadata
          })
          .eq('id', job_id);
    }

    console.log(`[Compositor-Inpainting][${job_id}] Compositing complete. Final URL: ${finalPublicUrl}`);
    return new Response(JSON.stringify({ success: true, finalImageUrl: finalPublicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Compositor-Inpainting][${job_id}] Error:`, error);
    const tableName = job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs';
    await supabase.from(tableName).update({ status: 'failed', error_message: `Compositor failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});