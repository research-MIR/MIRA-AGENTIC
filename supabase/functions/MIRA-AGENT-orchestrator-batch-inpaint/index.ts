import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(buffer);
};

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    // Example path: /storage/v1/object/public/mira-agent-user-uploads/user-id/vto-batch-source/file.png
    const pathStartIndex = url.pathname.indexOf(UPLOAD_BUCKET);
    if (pathStartIndex === -1) {
        throw new Error(`Could not find bucket name '${UPLOAD_BUCKET}' in URL path: ${publicUrl}`);
    }
    const filePath = decodeURIComponent(url.pathname.substring(pathStartIndex + UPLOAD_BUCKET.length + 1));

    if (!filePath) {
        throw new Error(`Could not parse file path from URL: ${publicUrl}`);
    }

    console.log(`[BatchInpaintWorker] Downloading from storage path: ${filePath}`);
    const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath);

    if (error) {
        throw new Error(`Failed to download from Supabase storage: ${error.message}`);
    }
    return data;
}

async function processPair(supabase: SupabaseClient, pair: any, userId: string, pairIndex: number) {
    const pairId = `pair-${pairIndex}-${Date.now()}`;
    console.log(`[BatchInpaintWorker][${pairId}] Starting processing.`);
    const { person_url, garment_url, appendix } = pair;
    console.log(`[BatchInpaintWorker][${pairId}] Person URL: ${person_url}, Garment URL: ${garment_url}`);

    // 1. Download images and convert to base64
    console.log(`[BatchInpaintWorker][${pairId}] Step 1: Downloading images...`);
    const [personBlob, garmentBlob] = await Promise.all([
        downloadFromSupabase(supabase, person_url),
        downloadFromSupabase(supabase, garment_url)
    ]);
    
    const [personBase64, garmentBase64] = await Promise.all([
        blobToBase64(personBlob),
        blobToBase64(garmentBlob)
    ]);
    console.log(`[BatchInpaintWorker][${pairId}] Images downloaded and encoded successfully.`);

    // 2. Get image dimensions
    console.log(`[BatchInpaintWorker][${pairId}] Step 2: Getting image dimensions...`);
    const { loadImage } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
    const personImageBuffer = await personBlob.arrayBuffer();
    const personImage = await loadImage(new Uint8Array(personImageBuffer));
    const image_dimensions = { width: personImage.width(), height: personImage.height() };
    console.log(`[BatchInpaintWorker][${pairId}] Source image dimensions: ${image_dimensions.width}x${image_dimensions.height}`);

    // 3. Auto-mask
    console.log(`[BatchInpaintWorker][${pairId}] Step 3: Invoking segmentation orchestrator...`);
    const { data: segmentationData, error: segmentationError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-segmentation', {
        body: {
            user_id: userId,
            image_base64: personBase64,
            mime_type: personBlob.type,
            reference_image_base64: garmentBase64,
            reference_mime_type: garmentBlob.type,
            image_dimensions,
        }
    });
    if (segmentationError) throw new Error(`Segmentation failed: ${segmentationError.message}`);
    const mask_image_url = segmentationData.finalMaskUrl;
    console.log(`[BatchInpaintWorker][${pairId}] Segmentation complete. Mask URL: ${mask_image_url}`);

    // 4. Auto-prompt
    console.log(`[BatchInpaintWorker][${pairId}] Step 4: Generating prompt...`);
    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
        body: {
            person_image_base64: personBase64,
            person_image_mime_type: personBlob.type,
            garment_image_base64: garmentBase64,
            garment_image_mime_type: garmentBlob.type,
            prompt_appendix: appendix,
            is_garment_mode: true,
        }
    });
    if (promptError) throw new Error(`Prompt generation failed: ${promptError.message}`);
    const finalPrompt = promptData.final_prompt;
    console.log(`[BatchInpaintWorker][${pairId}] Prompt generated: "${finalPrompt.substring(0, 60)}..."`);

    // 5. Queue inpainting job
    console.log(`[BatchInpaintWorker][${pairId}] Step 5: Queuing final inpainting job...`);
    const { error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
        body: {
            mode: 'inpaint',
            user_id: userId,
            full_source_image_base64: personBase64,
            mask_image_url: mask_image_url,
            prompt: finalPrompt,
            reference_image_base64: garmentBase64,
            denoise: 0.99,
            resolution: 'standard',
            mask_expansion_percent: 3,
            num_attempts: 1,
        }
    });
    if (proxyError) throw new Error(`Job queuing failed: ${proxyError.message}`);
    console.log(`[BatchInpaintWorker][${pairId}] Pair processed and job queued successfully.`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pairs, user_id } = await req.json();
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0 || !user_id) {
      throw new Error("`pairs` array and `user_id` are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    console.log(`[BatchInpaintOrchestrator] Received batch request with ${pairs.length} pairs for user ${user_id}.`);

    // Don't await this. Let it run in the background.
    Promise.allSettled(pairs.map((pair, index) => processPair(supabase, pair, user_id, index)))
        .then(results => {
            let successCount = 0;
            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    successCount++;
                    console.log(`[BatchInpaintOrchestrator] Worker for pair ${index} completed successfully.`);
                } else {
                    console.error(`[BatchInpaintOrchestrator] Worker for pair ${index} FAILED. Reason:`, result.reason);
                }
            });
            console.log(`[BatchInpaintOrchestrator] Batch complete. ${successCount}/${pairs.length} jobs queued successfully.`);
            // In a real app, you might send a notification to the user here.
        });

    return new Response(JSON.stringify({ success: true, message: `${pairs.length} jobs are being processed in the background.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[BatchInpaintOrchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});