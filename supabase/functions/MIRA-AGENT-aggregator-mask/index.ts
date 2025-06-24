import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const REQUIRED_RESULTS = 6;

interface MaskItemData {
    box_2d: [number, number, number, number];
    label: string;
    mask?: string;
}

async function processMasks(
  maskRuns: MaskItemData[][], 
  imageDimensions: { width: number; height: number }
): Promise<string | null> {
  if (maskRuns.length === 0) return null;
  const firstMasksFromEachRun = maskRuns.map(run => run[0]).filter(Boolean);
  if (firstMasksFromEachRun.length === 0) return null;

  const maskImages = await Promise.all(firstMasksFromEachRun.map(run => {
    const imageUrl = run.mask?.startsWith('data:image') ? run.mask : `data:image/png;base64,${run.mask}`;
    return loadImage(imageUrl);
  }));

  const fullMaskCanvases = firstMasksFromEachRun.map((run, index) => {
    const maskImg = maskImages[index];
    const [y0, x0, y1, x1] = run.box_2d;
    const absX0 = Math.floor((x0 / 1000) * imageDimensions.width);
    const absY0 = Math.floor((y0 / 1000) * imageDimensions.height);
    const bboxWidth = Math.ceil(((x1 - x0) / 1000) * imageDimensions.width);
    const bboxHeight = Math.ceil(((y1 - y0) / 1000) * imageDimensions.height);

    const fullCanvas = createCanvas(imageDimensions.width, imageDimensions.height);
    const ctx = fullCanvas.getContext('2d');
    ctx.drawImage(maskImg, absX0, absY0, bboxWidth, bboxHeight);
    return fullCanvas;
  });

  const combinedCanvas = createCanvas(imageDimensions.width, imageDimensions.height);
  const combinedCtx = combinedCanvas.getContext('2d');
  const maskImageDatas = fullMaskCanvases.map(c => c.getContext('2d').getImageData(0, 0, imageDimensions.width, imageDimensions.height).data);
  const combinedImageData = combinedCtx.createImageData(imageDimensions.width, imageDimensions.height);
  const combinedData = combinedImageData.data;

  for (let i = 0; i < combinedData.length; i += 4) {
      let voteCount = 0;
      for (const data of maskImageDatas) {
          if (data[i] > 128) voteCount++;
      }
      if (voteCount >= REQUIRED_RESULTS) {
          combinedData[i] = 255; combinedData[i+1] = 255; combinedData[i+2] = 255; combinedData[i+3] = 255;
      }
  }
  combinedCtx.putImageData(combinedImageData, 0, 0);
  return combinedCanvas.toDataURL().split(',')[1];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .select('status, results, source_image_dimensions')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    if (job.status === 'complete' || job.status === 'failed') {
      return new Response(JSON.stringify({ message: "Job already resolved." }), { headers: corsHeaders });
    }

    const results = job.results || [];
    if (results.length >= REQUIRED_RESULTS) {
      console.log(`[Aggregator][${job_id}] Sufficient results (${results.length}) received. Processing final mask.`);
      
      const finalMaskBase64 = await processMasks(results, job.source_image_dimensions);
      if (!finalMaskBase64) throw new Error("Mask processing resulted in an empty mask.");

      await supabase.from('mira-agent-mask-aggregation-jobs').update({
        status: 'complete',
        final_mask_base64: finalMaskBase64,
        source_image_base64: null, // Clear large data
      }).eq('id', job_id);

      console.log(`[Aggregator][${job_id}] Job completed successfully.`);
    } else {
      console.log(`[Aggregator][${job_id}] Received ${results.length}/${REQUIRED_RESULTS} results. Awaiting more.`);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error) {
    console.error(`[Aggregator][${job_id}] Error:`, error);
    await supabase.from('mira-agent-mask-aggregation-jobs').update({
        status: 'failed',
        error_message: `Aggregation failed: ${error.message}`
    }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: corsHeaders, status: 500 });
  }
});