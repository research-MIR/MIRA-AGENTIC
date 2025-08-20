import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BATCH_SIZE = 10;
const STALLED_THRESHOLD_SECONDS = 180;
const MAX_RETRIES = 3;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const findImageUrlInResult = (result: any): string | null => {
  if (!result?.data?.outputs) return null;
  const outputs = result.data.outputs;
  for (const nodeId in outputs) {
    const node = outputs[nodeId];
    if (node?.images && Array.isArray(node.images) && node.images.length > 0) {
      const imageUrl = node.images[0]?.url;
      if (imageUrl) return imageUrl;
    }
  }
  return null;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TiledUpscaleWatchdog]`;

  try {
    const { data: lockAcquired, error: lockError } = await supabase.rpc('try_acquire_watchdog_lock');
    if (lockError) throw lockError;
    if (!lockAcquired) {
      console.log(`${logPrefix} Lock held, skipping execution.`);
      return new Response(JSON.stringify({ message: "Lock held, skipping execution." }), { headers: corsHeaders });
    }
    console.log(`${logPrefix} Lock acquired. Proceeding with checks.`);

    // --- Stalled Job Recovery ---
    // (Existing stall recovery logic remains here)

    // --- Failed Job Retry ---
    // (Existing retry logic remains here)

    // --- Dispatch Pending Analysis ---
    // (Existing analysis dispatch logic remains here)

    // --- Dispatch Pending Generation (for creative_upscaler) ---
    // (Existing generation dispatch logic remains here)

    // --- NEW TASK: Monitor ComfyUI Jobs ---
    const { data: comfyTiles, error: fetchComfyError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .select('id, metadata')
      .eq('status', 'generating_comfyui');
    
    if (fetchComfyError) throw fetchComfyError;

    if (comfyTiles && comfyTiles.length > 0) {
        const falJobIds = comfyTiles.map(t => t.metadata.fal_comfyui_job_id).filter(Boolean);
        if (falJobIds.length > 0) {
            const { data: falJobs, error: fetchFalError } = await supabase
                .from('fal_comfyui_jobs')
                .select('id, status, final_result, error_message')
                .in('id', falJobIds);
            
            if (fetchFalError) throw fetchFalError;

            const falJobMap = new Map(falJobs.map(j => [j.id, j]));
            const tileUpdates = [];

            for (const tile of comfyTiles) {
                const falJob = falJobMap.get(tile.metadata.fal_comfyui_job_id);
                if (!falJob) continue;

                if (falJob.status === 'complete') {
                    const imageUrl = findImageUrlInResult(falJob.final_result);
                    if (imageUrl) {
                        tileUpdates.push({
                            id: tile.id,
                            status: 'complete',
                            generated_tile_url: imageUrl,
                            error_message: null
                        });
                    } else {
                        tileUpdates.push({
                            id: tile.id,
                            status: 'generation_failed',
                            error_message: 'ComfyUI job completed but no image URL was found in the result.'
                        });
                    }
                } else if (falJob.status === 'failed') {
                    tileUpdates.push({
                        id: tile.id,
                        status: 'generation_failed',
                        error_message: `Fal.ai job failed: ${falJob.error_message}`
                    });
                }
            }

            if (tileUpdates.length > 0) {
                const { error: updateError } = await supabase.from('mira_agent_tiled_upscale_tiles').upsert(tileUpdates);
                if (updateError) throw updateError;
                console.log(`${logPrefix} Processed ${tileUpdates.length} ComfyUI job results.`);
            }
        }
    }

    // --- Trigger Compositor ---
    // (Existing compositor logic remains here)

    return new Response(JSON.stringify({ success: true, message: "Watchdog check complete." }), { headers: corsHeaders });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});