import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

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
    const width = sourceImage.width();
    const height = sourceImage.height();
    
    const rawMaskCanvas = createCanvas(width, height);
    const rawMaskCtx = rawMaskCanvas.getContext('2d');
    rawMaskCtx.fillStyle = 'black';
    rawMaskCtx.fillRect(0, 0, width, height);

    const allMasks = (job.results || []).flat().filter((item: any) => item && item.mask && item.box_2d);

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

    const rawMaskUrl = await uploadBufferToStorage(supabase, rawMaskCanvas.toBuffer('image/png'), job.user_id, 'raw_mask.png');
    if (!rawMaskUrl) throw new Error("Failed to upload the raw mask to storage.");
    console.log(`[Compositor][${requestId}] Raw mask uploaded to: ${rawMaskUrl}`);

    const { data: parentPairJob, error: parentFetchError } = await supabase
        .from('mira-agent-batch-inpaint-pair-jobs')
        .select('id')
        .eq('metadata->>aggregation_job_id', aggregationJobId)
        .maybeSingle();

    if (parentFetchError) {
        console.warn(`[Compositor][${requestId}] Could not check for parent job: ${parentFetchError.message}`);
    } else if (parentPairJob) {
        console.log(`[Compositor][${requestId}] Found parent job ${parentPairJob.id}. Invoking expander function...`);
        await supabase.functions.invoke('MIRA-AGENT-expander-mask', {
            body: { 
                raw_mask_url: rawMaskUrl, 
                user_id: job.user_id,
                parent_pair_job_id: parentPairJob.id
            }
        });
    } else {
        console.warn(`[Compositor][${requestId}] No parent job found for aggregation job. Expansion step will not be triggered.`);
    }

    await supabase.from('mira-agent-mask-aggregation-jobs')
      .update({ status: 'complete', metadata: { raw_mask_url: rawMaskUrl } })
      .eq('id', aggregationJobId);
    
    return new Response(JSON.stringify({ success: true, rawMaskUrl }), {
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