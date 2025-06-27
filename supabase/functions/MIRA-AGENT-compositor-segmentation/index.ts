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

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array | null, userId: string, filename: string): Promise<string | null> {
    if (!buffer) return null;
    const filePath = `${userId}/vto-debug/${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) {
        console.error(`Storage upload failed for ${filename}: ${error.message}`);
        return null;
    }
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return publicUrl;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  let aggregationJobId: string | null = null;
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const body = await req.json();
    aggregationJobId = body.job_id;
    if (!aggregationJobId) {
      throw new Error("job_id is required.");
    }
    
    const requestId = `compositor-${aggregationJobId}`;
    console.log(`[Compositor][${requestId}] Function invoked.`);
    console.time(`[Compositor][${requestId}] Full Process`);

    console.time(`[Compositor][${requestId}] Fetch Job from DB`);
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .select('results, source_image_base64, user_id')
      .eq('id', aggregationJobId)
      .single();
    console.timeEnd(`[Compositor][${requestId}] Fetch Job from DB`);

    if (fetchError) throw fetchError;
    if (!job || !job.source_image_base64) {
      throw new Error("Job data or source image is missing.");
    }
    console.log(`[Compositor][${requestId}] Job data fetched. Source base64 length: ${job.source_image_base64.length}`);

    const sourceImageBuffer = decodeBase64(job.source_image_base64);
    const sourceImage = await loadImage(sourceImageBuffer);
    const width = sourceImage.width();
    const height = sourceImage.height();
    console.log(`[Compositor][${requestId}] Source image decoded with canvas. Dimensions: ${width}x${height}`);
    
    const finalMaskCanvas = createCanvas(width, height);
    const finalMaskCtx = finalMaskCanvas.getContext('2d');
    finalMaskCtx.fillStyle = 'black';
    finalMaskCtx.fillRect(0, 0, width, height);
    console.log(`[Compositor][${requestId}] Created final mask canvas.`);

    const allMasks = (job.results || []).flat().filter((item: any) => item && item.mask && item.box_2d);
    console.log(`[Compositor][${requestId}] Found ${allMasks.length} valid masks to process.`);

    for (const [index, maskData] of allMasks.entries()) {
        console.time(`[Compositor][${requestId}] Mask ${index + 1}`);
        try {
            const maskBase64 = maskData.mask.startsWith('data:image/png;base64,') 
                ? maskData.mask.split(',')[1] 
                : maskData.mask;
            const maskImageBuffer = decodeBase64(maskBase64);
            const maskImage = await loadImage(maskImageBuffer);
            
            const [y0, x0, y1, x1] = maskData.box_2d;
            const absX0 = Math.floor((x0 / 1000) * width);
            const absY0 = Math.floor((y0 / 1000) * height);
            const bboxWidth = Math.ceil(((x1 - x0) / 1000) * width);
            const bboxHeight = Math.ceil(((y1 - y0) / 1000) * height);

            if (bboxWidth > 0 && bboxHeight > 0) {
                finalMaskCtx.drawImage(maskImage, absX0, absY0, bboxWidth, bboxHeight);
            } else {
                console.warn(`[Compositor][${requestId}] Mask ${index + 1} has invalid dimensions (${bboxWidth}x${bboxHeight}). Skipping.`);
            }
        } catch (maskError) {
            console.error(`[Compositor][${requestId}] Failed to process mask ${index + 1}:`, maskError.message);
        }
        console.timeEnd(`[Compositor][${requestId}] Mask ${index + 1}`);
    }
    console.log(`[Compositor][${requestId}] All individual masks have been drawn onto the final mask canvas.`);

    const finalImageData = finalMaskCtx.getImageData(0, 0, width, height);
    const data = finalImageData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 0 || data[i+1] > 0 || data[i+2] > 0) {
            data[i] = 255; data[i+1] = 255; data[i+2] = 255;
        }
        data[i+3] = 255;
    }
    finalMaskCtx.putImageData(finalImageData, 0, 0);
    console.log(`[Compositor][${requestId}] Final mask canvas processed to be pure B&W.`);

    const finalMaskBuffer = finalMaskCanvas.toBuffer('image/png');
    const finalMaskBase64 = encodeBase64(finalMaskBuffer);
    console.log(`[Compositor][${requestId}] Final mask encoded to PNG buffer. Length: ${finalMaskBuffer.length}`);

    const finalMaskUrl = await uploadBufferToStorage(supabase, finalMaskBuffer, job.user_id, 'final_mask.png');
    if (!finalMaskUrl) {
        throw new Error("Failed to upload the final composited mask to storage.");
    }
    console.log(`[Compositor][${requestId}] Final mask uploaded to: ${finalMaskUrl}`);

    await supabase.from('mira-agent-mask-aggregation-jobs')
      .update({ 
          status: 'complete', 
          final_mask_base64: finalMaskBase64,
          metadata: { final_mask_url: finalMaskUrl }
      })
      .eq('id', aggregationJobId);

    const { data: parentPairJob, error: parentFetchError } = await supabase
        .from('mira-agent-batch-inpaint-pair-jobs')
        .select('id')
        .eq('metadata->>aggregation_job_id', aggregationJobId)
        .single();

    if (parentFetchError) {
        console.warn(`[Compositor][${requestId}] Could not check for parent job: ${parentFetchError.message}`);
    } else if (parentPairJob) {
        console.log(`[Compositor][${requestId}] Found parent batch job ${parentPairJob.id}. Triggering Step 2 worker.`);
        await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', {
            body: { pair_job_id: parentPairJob.id, final_mask_url: finalMaskUrl }
        });
    }
    
    console.timeEnd(`[Compositor][${requestId}] Full Process`);
    return new Response(JSON.stringify({ success: true, finalMaskUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Compositor][${aggregationJobId || 'unknown'}] Error:`, error);
    if (aggregationJobId) {
        await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', aggregationJobId);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});