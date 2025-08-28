import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const FAL_KEY = Deno.env.get('FAL_KEY');
const FAL_PIPELINE_ID = 'comfy/research-MIR/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const omnipresentPayload = {
  imagescaleby_scale_by: 0.5,
  controlnetapplyadvanced_strength: 0.15,
  controlnetapplyadvanced_end_percent: 0.4,
  basicscheduler_denoise: 0.5
};

function parseStorageURL(url: string) {
    const u = new URL(url);
    const pathSegments = u.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Invalid Supabase storage URL format: ${url}`);
    }
    const bucket = pathSegments[objectSegmentIndex + 2];
    const path = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    if (!bucket || !path) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${url}`);
    }
    return { bucket, path };
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const { bucket, path } = parseStorageURL(publicUrl);
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) throw new Error(`Failed to download from Supabase storage (${path}): ${error.message}`);
    return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  fal.config({ credentials: FAL_KEY! });
  const logPrefix = `[ComfyUI-Tiled-Proxy]`;
  let jobId: string | null = null;

  try {
    const { user_id, source_image_url, prompt, tile_id, metadata, use_blank_prompt } = await req.json();
    if (!user_id || !source_image_url || !tile_id) {
      throw new Error("user_id, source_image_url, and tile_id are required.");
    }

    // Idempotency Check
    const { data: existingJob, error: checkError } = await supabase
      .from('fal_comfyui_jobs')
      .select('id')
      .eq('metadata->>tile_id', tile_id)
      .in('status', ['queued', 'processing'])
      .maybeSingle();

    if (checkError) throw new Error(`Database error during idempotency check: ${checkError.message}`);
    if (existingJob) {
      console.log(`${logPrefix} Active job for tile_id ${tile_id} already exists (Job ID: ${existingJob.id}). Skipping creation.`);
      return new Response(JSON.stringify({ success: true, message: "Job already exists.", jobId: existingJob.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });
    }
    
    const finalPrompt = use_blank_prompt ? "" : (prompt || "a high-quality, detailed image");
    console.log(`${logPrefix} Received request for tile ${tile_id}. Using blank prompt: ${use_blank_prompt}. Final prompt: "${finalPrompt}"`);
    
    const { data: newJob, error: insertError } = await supabase.from('fal_comfyui_jobs').insert({
      user_id,
      status: 'queued',
      input_payload: { prompt: finalPrompt, source_image_url },
      metadata: { ...metadata, tile_id: tile_id, source: 'tiled_upscaler' }
    }).select('id').single();

    if (insertError) throw insertError;
    jobId = newJob.id;
    console.log(`${logPrefix} Created tracking job ${jobId} in fal_comfyui_jobs table.`);

    const webhookUrl = `${SUPABASE_URL}/functions/v1/MIRA-AGENT-webhook-comfyui-tiled-upscale?job_id=${jobId}&tile_id=${tile_id}`;
    
    console.log(`${logPrefix} Downloading image from Supabase to create data URI...`);
    const imageBlob = await downloadFromSupabase(supabase, source_image_url);
    const imageBase64 = encodeBase64(await imageBlob.arrayBuffer());
    const dataUri = `data:${imageBlob.type};base64,${imageBase64}`;
    console.log(`${logPrefix} Image converted to data URI.`);

    const finalPayload = {
      ...omnipresentPayload,
      cliptextencode_text: finalPrompt,
      loadimage_1: dataUri // Use the data URI instead of the public URL
    };
    
    console.log(`${logPrefix} Submitting job to Fal.ai. Payload keys: ${Object.keys(finalPayload).sort().join(',')}`);
    const falResult = await fal.queue.submit(FAL_PIPELINE_ID, {
      input: finalPayload,
      webhookUrl: webhookUrl
    });
    
    console.log(`${logPrefix} Job submitted successfully to Fal.ai. Request ID: ${falResult.request_id}`);
    await supabase.from('fal_comfyui_jobs').update({
      fal_request_id: falResult.request_id,
      input_payload: { ...finalPayload, loadimage_1: 'omitted_for_brevity' } // Don't save the huge data URI
    }).eq('id', jobId);
    
    return new Response(JSON.stringify({ success: true, jobId: jobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    if (jobId) {
      await supabase.from('fal_comfyui_jobs')
        .update({ status: 'failed', error_message: `Proxy submission failed: ${error.message}` })
        .eq('id', jobId);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});