import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const FAL_KEY = Deno.env.get('FAL_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!FAL_KEY) {
    return new Response(JSON.stringify({ error: "FAL_KEY is not set in environment variables." }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  fal.config({ credentials: FAL_KEY });
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { method, input, image_base64, mime_type, user_id } = await req.json();

    if (method === 'submit') {
      if (!user_id) throw new Error("user_id is required for submission.");
      
      let finalInput = { ...input };
      if (image_base64) {
        const imageBlob = new Blob([decodeBase64(image_base64)], { type: mime_type || 'image/jpeg' });
        const imageUrl = await fal.storage.upload(imageBlob);
        finalInput.loadimage_1 = imageUrl;
      }
      
      const falResult = await fal.queue.submit("comfy/research-MIR/test", { input: finalInput });
      
      const { data: newJob, error: insertError } = await supabase
        .from('fal_comfyui_jobs')
        .insert({
          user_id: user_id,
          fal_request_id: falResult.request_id,
          input_payload: finalInput,
          status: 'queued'
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      return new Response(JSON.stringify({ jobId: newJob.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      throw new Error(`Invalid method: ${method}. This proxy now only supports 'submit'.`);
    }
  } catch (error) {
    console.error("[FalComfyUIProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});