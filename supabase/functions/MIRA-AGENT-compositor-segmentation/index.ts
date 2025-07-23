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

    // --- ATOMIC UPDATE TO CLAIM THE JOB ---
    const { count, error: updateError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .update({ status: 'compositing' })
      .eq('id', aggregationJobId)
      .eq('status', 'aggregating'); // Only update if it's in the correct state

    if (updateError) {
        console.error(`[Compositor][${requestId}] Error trying to claim job:`, updateError.message);
        throw updateError;
    }

    if (count === 0) {
        console.log(`[Compositor][${requestId}] Job was already claimed by another instance or is not in 'aggregating' state. Exiting gracefully.`);
        return new Response(JSON.stringify({ success: true, message: "Job already claimed or not in a valid state for composition." }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }
    // --- END OF ATOMIC UPDATE ---

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .select('results, metadata, user_id')
      .eq('id', aggregationJobId)
      .single();

    if (fetchError) throw fetchError;
    const sourceImageUrl = job?.metadata?.source_image_storage_path;
    if (!job || !sourceImageUrl) {
      throw new Error("Job data or source image path is missing from metadata.");
    }

    const url = new URL(sourceImageUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
    const { data: imageBlob, error: downloadError } = await supabase.storage.from(bucketName).download(decodeURIComponent(filePath));
    if (downloadError) throw new Error(`Failed to download source image from storage: ${downloadError.message}`);
    const sourceImageBuffer = new Uint8Array(await imageBlob.arrayBuffer());

    const sourceImage = await loadImage(sourceImageBuffer);
    const width = sourceImage.width();
    const height = sourceImage.height();
    
    const rawMaskCanvas = createCanvas(width, height);
    const rawMaskCtx = rawMaskCanvas.getContext('2d');
    rawMaskCtx.fillStyle = 'black';
    rawMaskCtx.fillRect(0, 0, width, height);

    const allMasks = (job.results || []).flat().filter((item: any) => item && item.mask && item.box_2d);

    for (const maskData of allMasks) {
      try {
        const maskBase64 = maskData.mask.startsWith('data:image/png;base64,') 
            ? maskData.mask.split(',')[1] 
            : maskData.mask;
        
        if (!maskBase64) {
            console.warn(`[Compositor][${requestId}] Skipping a mask because its base64 data was empty.`);
            continue;
        }

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
      } catch (e) {
          console.warn(`[Compositor][${requestId}] Could not process a single mask from a worker. Error: ${e.message}. Skipping it and continuing.`);
          // Don't re-throw, just continue to the next mask
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
      .update({ status: 'complete', metadata: { ...job.metadata, raw_mask_url: rawMaskUrl } })
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