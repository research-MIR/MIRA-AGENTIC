import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const FAL_KEY = Deno.env.get('FAL_KEY');

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

  try {
    const { method, requestId, input, image_base64, mime_type } = await req.json();

    switch (method) {
      case 'submit': {
        let finalInput = { ...input };
        if (image_base64) {
          const imageBlob = new Blob([decodeBase64(image_base64)], { type: mime_type || 'image/jpeg' });
          const imageUrl = await fal.storage.upload(imageBlob);
          finalInput.loadimage_1 = imageUrl;
        }
        const result = await fal.queue.submit("comfy/research-MIR/test", { input: finalInput });
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      case 'status': {
        if (!requestId) throw new Error("requestId is required for status check.");
        const result = await fal.queue.status("comfy/research-MIR/test", { requestId, logs: true });
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      case 'result': {
        if (!requestId) throw new Error("requestId is required to fetch result.");
        const result = await fal.queue.result("comfy/research-MIR/test", { requestId });
        return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      default:
        throw new Error(`Invalid method: ${method}`);
    }
  } catch (error) {
    console.error("[FalComfyUIProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});