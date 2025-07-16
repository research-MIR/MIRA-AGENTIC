import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('object') + 2];
    const pathStartIndex = url.pathname.indexOf(bucketName) + bucketName.length + 1;
    const filePath = decodeURIComponent(url.pathname.substring(pathStartIndex));

    if (!bucketName || !filePath) {
        throw new Error(`Could not parse bucket or path from URL: ${publicUrl}`);
    }

    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    return data;
}

serve(async (req) => {
  console.log(`[BatchInpaintWorker-Step2] Function invoked.`);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { pair_job_id, final_mask_url } = await req.json();
  const logPrefix = `[BatchInpaintWorker-Step2][${pair_job_id}]`;
  console.log(`${logPrefix} Received payload. pair_job_id: ${pair_job_id}, final_mask_url: ${final_mask_url}`);

  if (!pair_job_id || !final_mask_url) {
    console.error(`${logPrefix} Missing required parameters.`);
    return new Response(JSON.stringify({ error: "pair_job_id and final_mask_url are required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: pairJob, error: fetchError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('*')
      .eq('id', pair_job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch pair job: ${fetchError.message}`);
    if (!pairJob) throw new Error(`Pair job with ID ${pair_job_id} not found.`);

    if (pairJob.inpainting_job_id) {
        console.warn(`${logPrefix} Safety check triggered. Inpainting job already exists (${pairJob.inpainting_job_id}). This is a duplicate invocation. Exiting gracefully.`);
        return new Response(JSON.stringify({ success: true, message: "Duplicate invocation detected, exiting." }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    const { user_id, source_person_image_url, source_garment_image_url, prompt_appendix, metadata } = pairJob;
    
    console.log(`${logPrefix} Downloading source and mask images...`);
    const [sourceBlob, maskBlob] = await Promise.all([
        downloadFromSupabase(supabase, source_person_image_url),
        downloadFromSupabase(supabase, final_mask_url)
    ]);

    const sourceImage = await Image.decode(await sourceBlob.arrayBuffer());
    const maskImage = await Image.decode(await maskBlob.arrayBuffer());
    const { width, height } = sourceImage;

    console.log(`${logPrefix} Calculating bounding box from mask...`);
    let minX = width, minY = height, maxX = 0, maxY = 0;

    for (const [x, y, color] of maskImage.iterateWithAlpha()) {
        if (color > 128) { // Check if pixel is not black (or transparent)
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }

    if (maxX < minX || maxY < minY) throw new Error("The provided mask is empty or invalid.");

    const padding = Math.round(Math.max(maxX - minX, maxY - minY) * 0.05);
    const bbox = {
      x: Math.max(0, minX - padding),
      y: Math.max(0, minY - padding),
      width: Math.min(width, maxX + padding) - Math.max(0, minX - padding),
      height: Math.min(height, maxY + padding) - Math.max(0, minY - padding),
    };
    console.log(`${logPrefix} Bounding box calculated with 5% padding:`, bbox);

    const croppedSourceImage = sourceImage.clone().crop(bbox.x, bbox.y, bbox.width, bbox.height);
    const croppedSourceBase64 = encodeBase64(await croppedSourceImage.encode(0)); // 0 for PNG

    const croppedMaskImage = maskImage.clone().crop(bbox.x, bbox.y, bbox.width, bbox.height);
    const croppedMaskBase64 = encodeBase64(await croppedMaskImage.encode(0));
    console.log(`${logPrefix} Source and mask images cropped and encoded.`);

    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
        body: {
            person_image_base64: croppedSourceBase64,
            garment_image_url: source_garment_image_url,
            prompt_appendix: prompt_appendix,
            is_helper_enabled: metadata?.is_helper_enabled !== false,
            is_garment_mode: true,
        }
    });
    if (promptError) throw new Error(`Prompt generation failed: ${promptError.message}`);
    const finalPrompt = promptData.final_prompt;
    console.log(`${logPrefix} Prompt generated: "${finalPrompt.substring(0, 50)}..."`);

    const { data: proxyData, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
        body: { 
            mode: 'inpaint',
            user_id: user_id,
            base64_image_data: croppedSourceBase64,
            base64_mask_data: croppedMaskBase64,
            prompt: finalPrompt,
            reference_image_url: source_garment_image_url,
            denoise: 0.99,
            resolution: 'standard',
            num_images: 1,
            batch_pair_job_id: pair_job_id,
            metadata: {
                ...metadata,
                bbox: bbox,
                full_source_image_url: source_person_image_url,
            }
        }
    });
    if (proxyError) throw new Error(`Job queuing failed: ${proxyError.message}`);
    
    const inpaintingJobId = proxyData?.jobIds?.[0];
    if (!inpaintingJobId) throw new Error('Delegation failed: Proxy did not return a valid job ID.');

    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
        .update({ status: 'delegated', inpainting_job_id: inpaintingJobId, metadata: { ...metadata, prompt_used: finalPrompt } })
        .eq('id', pair_job_id);

    console.log(`${logPrefix} Inpainting job queued successfully. Inpainting Job ID: ${inpaintingJobId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
      .update({ status: 'failed', error_message: error.message })
      .eq('id', pair_job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});