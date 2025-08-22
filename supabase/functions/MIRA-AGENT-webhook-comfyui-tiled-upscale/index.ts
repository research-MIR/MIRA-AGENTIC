import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // The invoke call from the mock proxy passes the query params in a custom header
    const customQuery = req.headers.get('x-custom-query') || '';
    const url = new URL(`http://localhost${customQuery}`);
    const jobId = url.searchParams.get('job_id');
    const tileId = url.searchParams.get('tile_id');

    if (!jobId || !tileId) {
      throw new Error("Webhook received without job_id or tile_id in the query parameters.");
    }

    const payload = await req.json();
    const { result, status } = payload;

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Update the comfyui job tracker
    if (status === 'success' && result) {
      await supabase
        .from('mira-agent-comfyui-jobs')
        .update({ status: 'complete', final_result: { publicUrl: result } })
        .eq('id', jobId);
    } else {
      await supabase
        .from('mira-agent-comfyui-jobs')
        .update({ status: 'failed', error_message: `ComfyUI reported failure. Status: ${status}.` })
        .eq('id', jobId);
    }

    // Update the main tile pipeline job
    if (status === 'success' && result) {
        const updatePayload: any = {
            status: 'complete',
            generated_tile_url: result,
        };

        if (result.includes('supabase.co')) {
            const { bucket, path } = parseStorageURL(result);
            updatePayload.generated_tile_bucket = bucket;
            updatePayload.generated_tile_path = path;
        }

        await supabase
            .from('mira_agent_tiled_upscale_tiles')
            .update(updatePayload)
            .eq('id', tileId);
    } else {
        await supabase
            .from('mira_agent_tiled_upscale_tiles')
            .update({
                status: 'generation_failed',
                error_message: `ComfyUI reported failure for this tile. Status: ${status}.`
            })
            .eq('id', tileId);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ComfyUI-Tiled-Webhook] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});