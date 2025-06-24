import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function logMemoryUsage(step: string) {
    const memory = Deno.memoryUsage();
    const heapUsedMb = (memory.heapUsed / 1024 / 1024).toFixed(2);
    console.log(`[Compositor][Memory] After step "${step}": Heap usage is ${heapUsedMb} MB`);
}

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array, userId: string, filename: string): Promise<string> {
    const filePath = `${userId}/segmentation-final/${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) {
        throw new Error(`Storage upload failed for ${filename}: ${error.message}`);
    }
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return publicUrl;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[Compositor][${job_id}] Job started. Triggered by database.`);
  console.time(`[Compositor][${job_id}] Full Process`);

  try {
    console.time(`[Compositor][${job_id}] Fetch Job from DB`);
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .select('results, source_image_dimensions, user_id')
      .eq('id', job_id)
      .single();
    console.timeEnd(`[Compositor][${job_id}] Fetch Job from DB`);
    logMemoryUsage("Fetch Job");

    if (fetchError) throw fetchError;
    if (!job) throw new Error("Job not found in database.");
    if (!job.source_image_dimensions) throw new Error("Job is missing source_image_dimensions.");
    if (!job.results || !Array.isArray(job.results)) throw new Error("Job results are missing or not an array.");

    console.log(`[Compositor][${job_id}] Received ${job.results.length} raw results from database.`);

    const validRuns = job.results.filter(run => run && Array.isArray(run.masks) && run.masks.length > 0);
    console.log(`[Compositor][${job_id}] Found ${validRuns.length} valid runs with masks.`);

    if (validRuns.length === 0) {
      throw new Error("No valid mask data found in any of the segmentation runs.");
    }

    const firstMasksFromEachRun = validRuns.map(run => run.masks[0]).filter(Boolean);
    if (firstMasksFromEachRun.length === 0) {
      throw new Error("Could not extract any valid masks from the successful runs.");
    }
    console.log(`[Compositor][${job_id}] Extracted ${firstMasksFromEachRun.length} masks to be combined.`);

    const maskImages = await Promise.all(firstMasksFromEachRun.map(run => {
        const imageUrl = run.mask?.startsWith('data:image') ? run.mask : `data:image/png;base64,${run.mask}`;
        return loadImage(imageUrl);
    }));
    logMemoryUsage("Load Mask Images");

    const fullMaskCanvases = firstMasksFromEachRun.map((run, index) => {
        const maskImg = maskImages[index];
        const [y0, x0, y1, x1] = run.box_2d;
        const absX0 = Math.floor((x0 / 1000) * job.source_image_dimensions.width);
        const absY0 = Math.floor((y0 / 1000) * job.source_image_dimensions.height);
        const bboxWidth = Math.ceil(((x1 - x0) / 1000) * job.source_image_dimensions.width);
        const bboxHeight = Math.ceil(((y1 - y0) / 1000) * job.source_image_dimensions.height);

        const fullCanvas = createCanvas(job.source_image_dimensions.width, job.source_image_dimensions.height);
        const ctx = fullCanvas.getContext('2d');
        ctx.drawImage(maskImg, absX0, absY0, bboxWidth, bboxHeight);
        return fullCanvas;
    });
    logMemoryUsage("Create Full-size Mask Canvases");

    const combinedCanvas = createCanvas(job.source_image_dimensions.width, job.source_image_dimensions.height);
    const combinedCtx = combinedCanvas.getContext('2d');
    const maskImageDatas = fullMaskCanvases.map(c => c.getContext('2d').getImageData(0, 0, job.source_image_dimensions.width, job.source_image_dimensions.height).data);
    const combinedImageData = combinedCtx.createImageData(job.source_image_dimensions.width, job.source_image_dimensions.height);
    const combinedData = combinedImageData.data;

    const majorityThreshold = Math.floor(maskImageDatas.length / 2) + 1;
    for (let i = 0; i < combinedData.length; i += 4) {
        let voteCount = 0;
        for (const data of maskImageDatas) {
            if (data[i] > 128) voteCount++;
        }
        if (voteCount >= majorityThreshold) {
            combinedData[i] = 255; combinedData[i+1] = 255; combinedData[i+2] = 255; combinedData[i+3] = 255;
        }
    }
    combinedCtx.putImageData(combinedImageData, 0, 0);
    logMemoryUsage("Combine Masks with Voting");

    const expansionAmount = Math.round(Math.min(job.source_image_dimensions.width, job.source_image_dimensions.height) * 0.01);
    if (expansionAmount > 0) {
        combinedCtx.filter = `blur(${expansionAmount}px)`;
        combinedCtx.drawImage(combinedCanvas, 0, 0);
        combinedCtx.filter = 'none';
        const smoothedImageData = combinedCtx.getImageData(0, 0, job.source_image_dimensions.width, job.source_image_dimensions.height);
        const smoothedData = smoothedImageData.data;
        for (let i = 0; i < smoothedData.length; i += 4) {
            if (smoothedData[i] > 128) {
                smoothedData[i] = 255; smoothedData[i+1] = 255; smoothedData[i+2] = 255;
            }
        }
        combinedCtx.putImageData(smoothedImageData, 0, 0);
    }
    logMemoryUsage("Smooth Mask");

    const finalImageData = combinedCtx.getImageData(0, 0, job.source_image_dimensions.width, job.source_image_dimensions.height);
    const finalData = finalImageData.data;
    for (let i = 0; i < finalData.length; i += 4) {
        if (finalData[i] > 128) {
            finalData[i] = 255; finalData[i + 1] = 0; finalData[i + 2] = 0; finalData[i + 3] = 150;
        } else {
            finalData[i + 3] = 0;
        }
    }
    combinedCtx.putImageData(finalImageData, 0, 0);
    logMemoryUsage("Colorize Mask");

    const finalImageBuffer = combinedCanvas.toBuffer('image/png');
    const finalPublicUrl = await uploadBufferToStorage(supabase, finalImageBuffer, job.user_id, 'final_mask.png');

    console.log(`[Compositor][${job_id}] Final mask uploaded. Updating job status to 'complete'.`);
    await supabase.from('mira-agent-mask-aggregation-jobs')
      .update({ status: 'complete', final_mask_base64: finalPublicUrl })
      .eq('id', job_id);

    console.timeEnd(`[Compositor][${job_id}] Full Process`);
    return new Response(JSON.stringify({ success: true, finalMaskUrl: finalPublicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Compositor][${job_id}] Error:`, error);
    await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});