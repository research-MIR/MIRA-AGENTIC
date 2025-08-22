import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const MOCK_IMAGE_URL = "https://ukxguvvbgjvukrsdnxmy.supabase.co/storage/v1/object/public/mira-generations/mock-upscale-tile.png";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[ComfyUI-Tiled-Proxy]`;

  try {
    const { user_id, source_image_url, prompt, tile_id, metadata } = await req.json();
    if (!user_id || !source_image_url || !prompt || !tile_id) {
      throw new Error("user_id, source_image_url, prompt, and tile_id are required.");
    }
    console.log(`${logPrefix} Received request for tile ${tile_id}.`);

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .insert({
        user_id,
        status: 'queued',
        comfyui_address: 'mocked_for_tiled_upscale',
        metadata: {
          ...metadata,
          source: 'tiled_upscaler',
          prompt_used: prompt,
          tile_id: tile_id
        }
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    const comfyJobId = newJob.id;
    console.log(`${logPrefix} Created tracking job ${comfyJobId} in comfyui_jobs table.`);

    const webhookUrl = `${SUPABASE_URL}/functions/v1/MIRA-AGENT-webhook-comfyui-tiled-upscale?job_id=${comfyJobId}&tile_id=${tile_id}`;

    console.log(`${logPrefix} MOCKING API call. Immediately invoking webhook with a placeholder image.`);
    
    // In a real scenario, you would call the external API here.
    // For this mock, we immediately invoke our own webhook.
    supabase.functions.invoke('MIRA-AGENT-webhook-comfyui-tiled-upscale', {
        body: {
            status: 'success',
            result: MOCK_IMAGE_URL
        },
        headers: {
            'x-custom-query': `?job_id=${comfyJobId}&tile_id=${tile_id}`
        }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: comfyJobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});