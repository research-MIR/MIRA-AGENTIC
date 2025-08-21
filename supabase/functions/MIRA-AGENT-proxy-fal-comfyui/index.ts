import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
const FAL_KEY = Deno.env.get('FAL_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
// A single, omnipresent set of parameters as requested.
const omnipresentPayload = {
  ksampler_denoise: 0.25000000000000004,
  imagescaleby_scale_by: 0.5,
  controlnetapplyadvanced_strength: 0.3,
  controlnetapplyadvanced_end_percent: 0.7000000000000002
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  if (!FAL_KEY) {
    return new Response(JSON.stringify({
      error: "FAL_KEY is not set in environment variables."
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
  fal.config({
    credentials: FAL_KEY
  });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  try {
    const { method, prompt, image_base64, mime_type, image_url, user_id, tile_id } = await req.json();
    if (method === 'submit') {
      if (!user_id) throw new Error("user_id is required for submission.");
      if (!image_url && !image_base64) throw new Error("Either image_url or image_base64 is required.");
      let finalImageUrl = image_url;
      if (image_base64) {
        const imageBlob = new Blob([
          decodeBase64(image_base64)
        ], {
          type: mime_type || 'image/jpeg'
        });
        finalImageUrl = await fal.storage.upload(imageBlob);
      }
      const pipeline = Deno.env.get('FAL_PIPELINE_ID') || 'comfy/research-MIR/test';
      let falResult;
      let lastError = null;
      const finalPayload = {
        ...omnipresentPayload,
        cliptextencode_text: prompt || "",
        loadimage_1: finalImageUrl
      };
      for(let attempt = 1; attempt <= MAX_RETRIES; attempt++){
        try {
          falResult = await fal.queue.submit(pipeline, {
            input: finalPayload
          });
          lastError = null;
          break; // Success
        } catch (error) {
          lastError = error;
          console.warn(`[FalComfyUIProxy] Attempt ${attempt} failed:`, error.message);
          if (attempt < MAX_RETRIES) {
            await new Promise((resolve)=>setTimeout(resolve, RETRY_DELAY_MS * attempt));
          }
        }
      }
      if (lastError) throw lastError;
      if (!falResult) throw new Error("Fal.ai submission failed after all retries without a specific error.");
      const { data: newJob, error: insertError } = await supabase.from('fal_comfyui_jobs').insert({
        user_id: user_id,
        fal_request_id: falResult.request_id,
        input_payload: finalPayload,
        status: 'queued',
        metadata: {
          tile_id: tile_id
        }
      }).select('id').single();
      if (insertError) throw insertError;
      return new Response(JSON.stringify({
        jobId: newJob.id
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    } else {
      throw new Error(`Invalid method: ${method}. This proxy now only supports 'submit'.`);
    }
  } catch (error) {
    console.error("[FalComfyUIProxy] Error:", error);
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
