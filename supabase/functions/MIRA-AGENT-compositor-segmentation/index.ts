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
        throw new Error(`Storage upload failed for ${filename}: ${error.message}`);
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

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .select('results, source_image_base64, user_id')
      .eq('id', aggregationJobId)
      .single();

    if (fetchError) throw fetchError;
    if (!job || !job.source_image_base64) {
      throw new Error("Job data or source image is missing.");
    }

    const sourceImageBuffer = decodeBase64(job.source_image_base64);
    const sourceImage = await loadImage(sourceImageBuffer);
    const width = sourceImage.width;
    const height = sourceImage.height;
    console.log(`[Compositor][${requestId}] Source image decoded. Dimensions: ${width}x${height}`);
    
    const rawMaskCanvas = createCanvas(width, height);
    const rawMaskCtx = rawMaskCanvas.getContext('2d');
    // Start with a transparent background
    rawMaskCtx.clearRect(0, 0, width, height);

    const allMasks = (job.results || []).flat().filter((item: any) => item && item.mask && item.box_2d);
    console.log(`[Compositor][${requestId}] Found ${allMasks.length} valid masks to process.`);

    for (const maskData of allMasks) {
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
            rawMaskCtx.drawImage(maskImage, absX0, absY0, bboxWidth, bboxHeight);
        }
    }

    // For debugging, create a viewable version of the raw mask (white on black)
    const previewMaskCanvas = createCanvas(width, height);
    const previewMaskCtx = previewMaskCanvas.getContext('2d');
    previewMaskCtx.fillStyle = 'black';
    previewMaskCtx.fillRect(0, 0, width, height);
    previewMaskCtx.drawImage(rawMaskCanvas, 0, 0);
    const rawMaskUrl = await uploadBufferToStorage(supabase, previewMaskCanvas.toBuffer('image/png'), job.user_id, 'raw_mask.png');
    console.log(`[Compositor][${requestId}] Raw mask uploaded to: ${rawMaskUrl}`);

    // --- CORRECTED MASK EXPANSION LOGIC ---
    const expansionRadius = Math.round(Math.min(width, height) * 0.06); // 6% radius for ~12% diameter increase
    console.log(`[Compositor][${requestId}] Applying mask expansion with blur filter radius: ${expansionRadius}px`);

    const expansionCanvas = createCanvas(width, height);
    const expansionCtx = expansionCanvas.getContext('2d');

    // 1. Apply blur filter to the raw mask (which has a transparent background)
    expansionCtx.filter = `blur(${expansionRadius}px)`;
    expansionCtx.drawImage(rawMaskCanvas, 0, 0);
    expansionCtx.filter = 'none'; // Reset filter

    // 2. Solidify the result into a pure black and white image
    const finalCanvas = createCanvas(width, height);
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.fillStyle = 'black';
    finalCtx.fillRect(0, 0, width, height);
    finalCtx.drawImage(expansionCanvas, 0, 0); // Draw the blurred (now glowing) mask

    const imageData = finalCtx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        // If any color channel has a value > 5, it's part of the mask or its glow.
        if (data[i] > 5 || data[i+1] > 5 || data[i+2] > 5) { 
            data[i] = 255; data[i + 1] = 255; data[i + 2] = 255;
        }
    }
    finalCtx.putImageData(imageData, 0, 0);
    console.log(`[Compositor][${requestId}] Mask expansion and solidification complete.`);
    // --- END OF CORRECTED LOGIC ---

    const finalMaskBuffer = finalCanvas.toBuffer('image/png');
    const finalMaskBase64 = encodeBase64(finalMaskBuffer);
    const expandedMaskUrl = await uploadBufferToStorage(supabase, finalMaskBuffer, job.user_id, 'final_expanded_mask.png');
    if (!expandedMaskUrl) throw new Error("Failed to upload the final composited mask to storage.");
    console.log(`[Compositor][${requestId}] Final expanded mask uploaded to: ${expandedMaskUrl}`);

    const { data: parentPairJob } = await supabase
        .from('mira-agent-batch-inpaint-pair-jobs')
        .select('id, metadata')
        .eq('metadata->>aggregation_job_id', aggregationJobId)
        .maybeSingle();

    if (parentPairJob) {
        const debug_assets = { raw_mask_url: rawMaskUrl, expanded_mask_url: expandedMaskUrl };
        await supabase.from('mira-agent-batch-inpaint-pair-jobs')
            .update({ metadata: { ...parentPairJob.metadata, debug_assets } })
            .eq('id', parentPairJob.id);
        await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', {
            body: { pair_job_id: parentPairJob.id, final_mask_url: expandedMaskUrl }
        });
    }

    await supabase.from('mira-agent-mask-aggregation-jobs')
      .update({ 
          status: 'complete', 
          final_mask_base64: finalMaskBase64,
          metadata: { final_mask_url: expandedMaskUrl, raw_mask_url: rawMaskUrl }
      })
      .eq('id', aggregationJobId);
    
    console.timeEnd(`[Compositor][${requestId}] Full Process`);
    return new Response(JSON.stringify({ success: true, finalMaskUrl: expandedMaskUrl }), {
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