import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'enhancor-ai-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Resilience Helper ---
async function retry<T>(fn: () => Promise<T>, retries = 3, delay = 1000, logPrefix = ""): Promise<T> {
    let lastError: Error | null = null;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            console.warn(`${logPrefix} Attempt ${i + 1}/${retries} failed: ${error.message}. Retrying in ${delay * (i + 1)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1))); // Linear backoff
        }
    }
    throw lastError;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { tile_id } = await req.json();
  if (!tile_id) {
    return new Response(JSON.stringify({ error: "tile_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TileGeneratorWorker][${tile_id}]`;

  try {
    const { data: claimedTile, error: claimError } = await retry(() => 
        supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({ status: 'generating' })
        .eq('id', tile_id)
        .eq('status', 'pending_generation')
        .select('parent_job_id, source_tile_bucket, source_tile_path, generated_prompt')
        .single()
        .then(res => { if (res.error && res.error.code !== 'PGRST116') throw res.error; return res; }),
        3, 1000, logPrefix
    );

    if (!claimedTile) {
      console.log(`${logPrefix} Tile already claimed or not in 'pending_generation' state. Exiting.`);
      return new Response(JSON.stringify({ success: true, message: "Tile not eligible for generation." }), { headers: corsHeaders });
    }

    const { parent_job_id, source_tile_bucket, source_tile_path, generated_prompt } = claimedTile;

    const { data: parentJob, error: fetchParentError } = await retry(() => 
        supabase
        .from('mira_agent_tiled_upscale_jobs')
        .select('user_id, metadata')
        .eq('id', parent_job_id)
        .single()
        .then(res => { if (res.error) throw res.error; return res; }),
        3, 1000, logPrefix
    );
    
    const { data: { publicUrl: originalTileUrl } } = supabase.storage.from(source_tile_bucket).getPublicUrl(source_tile_path);

    const engine = parentJob.metadata?.upscaler_engine || 'enhancor_detailed';
    console.log(`${logPrefix} Dispatching to engine: ${engine}`);

    if (engine.startsWith('comfyui')) {
        if (!generated_prompt) {
            throw new Error("Cannot use ComfyUI engine: tile is missing a generated_prompt.");
        }
        await retry(() => 
            supabase.functions.invoke('MIRA-AGENT-proxy-comfyui-tiled-upscale', {
                body: {
                    user_id: parentJob.user_id,
                    source_image_url: originalTileUrl,
                    prompt: generated_prompt,
                    tile_id: tile_id,
                    metadata: { original_tile_url: originalTileUrl }
                }
            }).then(res => { if (res.error) throw res.error; return res; }),
            3, 5000, logPrefix // Longer delay for function invocation
        );

    } else { // Default to Enhancor
        const transformedUrl = `${originalTileUrl}?format=jpeg&quality=95`;
        const response = await fetch(transformedUrl);
        if (!response.ok) throw new Error(`Failed to fetch and convert image from Supabase Storage. Status: ${response.status}`);
        const imageBlob = await response.blob();

        const convertedFilePath = `${parentJob.user_id}/enhancor-sources/converted/${Date.now()}-tile-${tile_id}.jpeg`;
        await retry(() => 
            supabase.storage.from(UPLOAD_BUCKET).upload(convertedFilePath, imageBlob, { contentType: 'image/jpeg', upsert: true })
            .then(res => { if (res.error) throw res.error; return res; }),
            3, 1000, logPrefix
        );

        const { data: { publicUrl: convertedImageUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(convertedFilePath);
        console.log(`${logPrefix} Converted image stored at: ${convertedImageUrl}`);

        await retry(() => 
            supabase.functions.invoke('MIRA-AGENT-proxy-enhancor-ai', {
              body: {
                user_id: parentJob.user_id,
                source_image_urls: [convertedImageUrl],
                enhancor_mode: engine,
                tile_id: tile_id,
                metadata: { original_tile_url: originalTileUrl }
              }
            }).then(res => { if (res.error) throw res.error; return res; }),
            3, 5000, logPrefix // Longer delay for function invocation
        );
    }

    console.log(`${logPrefix} Successfully dispatched tile to the appropriate proxy.`);
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'generation_failed', error_message: `Generation worker failed: ${error.message}` }).eq('id', tile_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});