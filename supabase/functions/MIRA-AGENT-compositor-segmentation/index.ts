import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage, Canvas } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const NUM_WORKERS = 5; // Must match the orchestrator

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array, userId: string, filename: string): Promise<string> {
    const filePath = `${userId}/segmentation-debug/${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) throw new Error(`Storage upload failed for ${filename}: ${error.message}`);
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return publicUrl;
}

function expandMask(canvas: Canvas, expansionPercent: number) {
    if (expansionPercent <= 0) return;
    const ctx = canvas.getContext('2d');
    const expansionAmount = Math.round(Math.min(canvas.width, canvas.height) * expansionPercent);
    if (expansionAmount <= 0) return;
    const tempCanvas = createCanvas(canvas.width, canvas.height);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.shadowColor = 'white';
    ctx.shadowBlur = expansionAmount;
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.shadowBlur = 0;
    ctx.drawImage(tempCanvas, 0, 0);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[Compositor][${job_id}] Starting composition...`);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    if (!job) throw new Error("Job not found.");
    if (job.status !== 'compositing') {
        console.warn(`[Compositor][${job.id}] Job status is '${job.status}', not 'compositing'. Halting.`);
        return new Response(JSON.stringify({ message: "Job not ready for composition." }), { headers: corsHeaders });
    }

    const results = job.results || [];
    const validMasks = results.flat().filter((mask: any) => mask && !mask.error && mask.mask && typeof mask.mask === 'string' && mask.box_2d);
    if (validMasks.length === 0) throw new Error("No valid mask data found in any of the segmentation runs.");
    
    const accumulator = new Uint8Array(job.source_image_dimensions.width * job.source_image_dimensions.height);

    for (const maskData of validMasks) {
      try {
        let base64Data = maskData.mask.startsWith('data:') ? maskData.mask.split(',')[1] : maskData.mask;
        const imageBuffer = decodeBase64(base64Data);
        const maskImg = await loadImage(imageBuffer);
        const [y0, x0, y1, x1] = Array.isArray(maskData.box_2d[0]) ? [maskData.box_2d[0][0], maskData.box_2d[0][1], maskData.box_2d[1][0], maskData.box_2d[1][1]] : maskData.box_2d;
        const absX0 = Math.floor((x0 / 1000) * job.source_image_dimensions.width);
        const absY0 = Math.floor((y0 / 1000) * job.source_image_dimensions.height);
        const bboxWidth = Math.ceil(((x1 - x0) / 1000) * job.source_image_dimensions.width);
        const bboxHeight = Math.ceil(((y1 - y0) / 1000) * job.source_image_dimensions.height);
        
        const tempCanvas = createCanvas(job.source_image_dimensions.width, job.source_image_dimensions.height);
        tempCanvas.getContext('2d').drawImage(maskImg, absX0, absY0, bboxWidth, bboxHeight);
        const imageData = tempCanvas.getContext('2d').getImageData(0, 0, job.source_image_dimensions.width, job.source_image_dimensions.height).data;
        for (let i = 0; i < imageData.length; i += 4) {
          if (imageData[i] > 128) accumulator[i / 4]++;
        }
      } catch (e) {
          console.warn(`[Compositor][${job.id}] Skipping one mask due to processing error:`, e.message);
      }
    }

    const combinedCanvas = createCanvas(job.source_image_dimensions.width, job.source_image_dimensions.height);
    const combinedCtx = combinedCanvas.getContext('2d');
    const combinedImageData = combinedCtx.createImageData(job.source_image_dimensions.width, job.source_image_dimensions.height);
    const combinedData = combinedImageData.data;
    
    const majorityThreshold = Math.floor(NUM_WORKERS / 2.5);
    for (let i = 0; i < accumulator.length; i++) {
      if (accumulator[i] >= majorityThreshold) {
        const idx = i * 4;
        combinedData[idx] = 255; combinedData[idx + 1] = 255; combinedData[idx + 2] = 255; combinedData[idx + 3] = 255;
      }
    }
    combinedCtx.putImageData(combinedImageData, 0, 0);
    
    const rawMaskUrl = await uploadBufferToStorage(supabase, combinedCanvas.toBuffer('image/png'), job.user_id, 'raw_combined_mask.png');
    
    expandMask(combinedCanvas, 0.03);
    const expandedMaskUrl = await uploadBufferToStorage(supabase, combinedCanvas.toBuffer('image/png'), job.user_id, 'expanded_final_mask.png');

    const { data: parentPairJob, error: parentFetchError } = await supabase
        .from('mira-agent-batch-inpaint-pair-jobs')
        .select('id, metadata')
        .eq('metadata->>aggregation_job_id', job.id)
        .maybeSingle();

    if (parentFetchError) console.error(`[Compositor][${job.id}] Error finding parent pair job:`, parentFetchError.message);
    else if (parentPairJob) {
        const newMetadata = { ...parentPairJob.metadata, debug_assets: { raw_mask_url: rawMaskUrl, expanded_mask_url: expandedMaskUrl } };
        await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({ metadata: newMetadata }).eq('id', parentPairJob.id);
    }

    await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'complete', final_mask_base64: expandedMaskUrl, source_image_base64: null }).eq('id', job.id);
    
    if (parentPairJob) {
        await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', { body: { pair_job_id: parentPairJob.id, final_mask_url: expandedMaskUrl } });
    }

    return new Response(JSON.stringify({ success: true, finalMaskUrl: expandedMaskUrl }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[Compositor][${job_id}] Error:`, error);
    await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});