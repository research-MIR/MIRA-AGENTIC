import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const MINIMUM_REQUIRED_RESULTS = 3;
const JOB_TIMEOUT_SECONDS = 90;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function logMemoryUsage(step: string, requestId: string) {
    const memory = Deno.memoryUsage();
    const heapUsedMb = (memory.heapUsed / 1024 / 1024).toFixed(2);
    console.log(`[Orchestrator][${requestId}] Memory after step "${step}": Heap usage is ${heapUsedMb} MB`);
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

async function runComposition(supabase: SupabaseClient, job: any, requestId: string) {
    console.log(`[Orchestrator][${requestId}] Starting composition for job ${job.id}.`);
    console.time(`[Orchestrator][${requestId}] Full Composition Process`);

    if (!job.source_image_dimensions) throw new Error("Job is missing source_image_dimensions.");
    if (!job.results || !Array.isArray(job.results)) throw new Error("Job results are missing or not an array.");

    const validRuns = job.results.filter(run => run && !run.error && Array.isArray(run.masks) && run.masks.length > 0);
    if (validRuns.length === 0) throw new Error("No valid mask data found in any of the segmentation runs.");
    
    console.log(`[Orchestrator][${requestId}] Found ${validRuns.length} valid runs with masks.`);
    const firstMasksFromEachRun = validRuns.map(run => run.masks[0]).filter(Boolean);
    if (firstMasksFromEachRun.length === 0) throw new Error("Could not extract any valid masks from the successful runs.");

    const maskImages = await Promise.all(firstMasksFromEachRun.map(run => {
        const imageUrl = run.mask?.startsWith('data:image') ? run.mask : `data:image/png;base64,${run.mask}`;
        return loadImage(imageUrl);
    }));
    logMemoryUsage("Load Mask Images", requestId);

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
    logMemoryUsage("Create Full-size Mask Canvases", requestId);

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
    logMemoryUsage("Combine Masks with Voting", requestId);

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
    logMemoryUsage("Smooth Mask", requestId);

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
    logMemoryUsage("Colorize Mask", requestId);

    const finalImageBuffer = combinedCanvas.toBuffer('image/png');
    const finalPublicUrl = await uploadBufferToStorage(supabase, finalImageBuffer, job.user_id, 'final_mask.png');

    console.log(`[Orchestrator][${requestId}] Final mask uploaded. Updating job status to 'complete'.`);
    await supabase.from('mira-agent-mask-aggregation-jobs')
      .update({ status: 'complete', final_mask_base64: finalPublicUrl })
      .eq('id', job.id);

    console.timeEnd(`[Orchestrator][${requestId}] Full Composition Process`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const body = await req.json();
  const { job_id } = body;
  const requestId = `segment-orchestrator-${job_id || Date.now()}`;
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    // Case 1: This is a re-entrant call from the watchdog to check on an existing job.
    if (job_id) {
      console.log(`[Orchestrator][${requestId}] Re-entrant call for job ${job_id}.`);
      const { data: job, error: fetchError } = await supabase
        .from('mira-agent-mask-aggregation-jobs')
        .select('*')
        .eq('id', job_id)
        .single();

      if (fetchError) throw fetchError;
      if (!job) throw new Error(`Job ${job_id} not found.`);

      await supabase.from('mira-agent-mask-aggregation-jobs').update({ updated_at: new Date().toISOString() }).eq('id', job_id);

      if (job.status === 'aggregating') {
        const resultsCount = job.results?.length || 0;
        const validResultsCount = job.results?.filter((r: any) => r && !r.error && Array.isArray(r.masks) && r.masks.length > 0).length || 0;
        const jobAgeSeconds = (Date.now() - new Date(job.created_at).getTime()) / 1000;

        console.log(`[Orchestrator][${requestId}] Job is 'aggregating'. Total results: ${resultsCount}, Valid results: ${validResultsCount}, Age: ${jobAgeSeconds.toFixed(0)}s.`);

        if (resultsCount >= 6) {
          console.log(`[Orchestrator][${requestId}] All 6 workers have reported. Transitioning to 'compositing'.`);
          await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'compositing' }).eq('id', job_id);
          await runComposition(supabase, job, requestId);
        } else if (jobAgeSeconds > JOB_TIMEOUT_SECONDS) {
            if (validResultsCount >= MINIMUM_REQUIRED_RESULTS) {
                console.log(`[Orchestrator][${requestId}] Job has timed out but has enough results (${validResultsCount}). Forcing composition.`);
                await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'compositing' }).eq('id', job_id);
                await runComposition(supabase, job, requestId);
            } else {
                console.error(`[Orchestrator][${requestId}] Job timed out with insufficient valid results (${validResultsCount}). Marking as failed.`);
                await supabase.from('mira-agent-mask-aggregation-jobs')
                  .update({ status: 'failed', error_message: `Job timed out after ${JOB_TIMEOUT_SECONDS} seconds with only ${validResultsCount} valid results.` })
                  .eq('id', job_id);
            }
        } else {
          console.log(`[Orchestrator][${requestId}] Not enough results yet. Waiting for more.`);
        }
      } else if (job.status === 'compositing') {
        console.log(`[Orchestrator][${requestId}] Job is 'compositing'. Starting composition logic.`);
        await runComposition(supabase, job, requestId);
      } else {
        console.log(`[Orchestrator][${requestId}] Job is in status '${job.status}'. No action taken by watchdog.`);
      }
      
      return new Response(JSON.stringify({ success: true, message: "Checked job status." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Case 2: This is a new job creation call.
    const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type, user_id, image_dimensions } = body;
    console.log(`[Orchestrator][${requestId}] New job creation invoked.`);

    if (!user_id || !image_base64 || !mime_type || !prompt || !image_dimensions) {
      throw new Error("Missing required parameters for new job: user_id, image_base64, mime_type, prompt, and image_dimensions are required.");
    }

    console.log(`[Orchestrator][${requestId}] Creating aggregation job record in DB...`);
    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .insert({
        user_id: user_id,
        status: 'aggregating',
        source_image_dimensions: image_dimensions,
        results: [],
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    const aggregation_job_id = newJob.id;
    console.log(`[Orchestrator][${requestId}] Aggregation job ${aggregation_job_id} created.`);

    const workerPayload = {
      image_base64, mime_type, prompt,
      reference_image_base64, reference_mime_type,
      aggregation_job_id,
    };

    console.log(`[Orchestrator][${requestId}] Invoking 6 segmentation workers asynchronously...`);
    const workerPromises = Array.from({ length: 6 }).map(() => 
      supabase.functions.invoke('MIRA-AGENT-tool-segment-image', { body: workerPayload })
    );

    Promise.allSettled(workerPromises).then(results => {
        const failedCount = results.filter(r => r.status === 'rejected').length;
        if (failedCount > 0) {
            console.warn(`[Orchestrator][${requestId}] ${failedCount} worker invocations failed.`);
        } else {
            console.log(`[Orchestrator][${requestId}] All 6 workers invoked successfully.`);
        }
    });

    return new Response(JSON.stringify({ success: true, aggregation_job_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Orchestrator][${requestId}] Error:`, error);
    if (job_id) {
        await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});