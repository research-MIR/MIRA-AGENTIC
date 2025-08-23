import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const FAL_KEY = Deno.env.get('FAL_KEY');
const FAL_PIPELINE_ID = 'comfy/research-MIR/test';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const omnipresentPayload = {
  imagescaleby_scale_by: 0.5,
  controlnetapplyadvanced_strength: 0.15,
  controlnetapplyadvanced_end_percent: 0.25,
  basicscheduler_denoise: 0.65
};

serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  fal.config({
    credentials: FAL_KEY!
  });
  const logPrefix = `[ComfyUI-Tiled-Proxy]`;
  try {
    const { user_id, source_image_url, prompt, tile_id, metadata, use_blank_prompt } = await req.json();
    if (!user_id || !source_image_url || !tile_id) {
      throw new Error("user_id, source_image_url, and tile_id are required.");
    }
    const finalPrompt = use_blank_prompt ? "" : prompt || "a high-quality, detailed image";
    console.log(`${logPrefix} Received request for tile ${tile_id}. Using blank prompt: ${use_blank_prompt}. Final prompt: "${finalPrompt}"`);
    const { data: newJob, error: insertError } = await supabase.from('fal_comfyui_jobs').insert({
      user_id,
      status: 'queued',
      input_payload: {
        prompt: finalPrompt,
        source_image_url
      },
      metadata: {
        ...metadata,
        tile_id: tile_id,
        source: 'tiled_upscaler'
      }
    }).select('id').single();
    if (insertError) throw insertError;
    const jobId = newJob.id;
    console.log(`${logPrefix} Created tracking job ${jobId} in fal_comfyui_jobs table.`);
    const webhookUrl = `${SUPABASE_URL}/functions/v1/MIRA-AGENT-webhook-comfyui-tiled-upscale?job_id=${jobId}&tile_id=${tile_id}`;
    
    const finalPayload = {
      ...omnipresentPayload,
      cliptextencode_text: finalPrompt,
      loadimage_1: source_image_url
    };
    
    console.log(`${logPrefix} Submitting job to Fal.ai...`);
    const falResult = await fal.queue.submit(FAL_PIPELINE_ID, {
      input: finalPayload,
      webhookUrl: webhookUrl
    });
    
    console.log(`${logPrefix} Job submitted successfully to Fal.ai. Request ID: ${falResult.request_id}`);
    await supabase.from('fal_comfyui_jobs').update({
      fal_request_id: falResult.request_id,
      input_payload: finalPayload
    }).eq('id', jobId);
    
    return new Response(JSON.stringify({
      success: true,
      jobId: jobId
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});