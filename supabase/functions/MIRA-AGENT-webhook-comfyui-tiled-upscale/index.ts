import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const FAL_WEBHOOK_SECRET = Deno.env.get('FAL_WEBHOOK_SECRET');
const GENERATED_IMAGES_BUCKET = 'mira-agent-upscale-tiles';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

async function verifyHmacSHA256(body: string, signature: string | null, secret: string): Promise<boolean> {
    if (!signature) return false;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"]
    );
    const sigBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(body));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[FalComfyUI-Webhook]`;

  try {
    if (!FAL_WEBHOOK_SECRET) {
        console.error(`${logPrefix} CRITICAL: FAL_WEBHOOK_SECRET is not set. Cannot verify request authenticity.`);
        throw new Error("Webhook secret is not configured.");
    }
    const signature = req.headers.get("x-fal-signature");
    const body = await req.text();
    const isVerified = await verifyHmacSHA256(body, signature, FAL_WEBHOOK_SECRET);
    if (!isVerified) {
        console.error(`${logPrefix} Invalid signature received. Rejecting request.`);
        return new Response("Invalid signature", { status: 401 });
    }
    const payload = JSON.parse(body);

    const url = new URL(req.url);
    let jobId = url.searchParams.get('job_id');
    let tileId = url.searchParams.get('tile_id');

    if (!jobId || !tileId) {
      throw new Error("Webhook received without job_id or tile_id in the query parameters.");
    }

    jobId = jobId.replace(/[^A-Fa-f0-9-]/g, '');
    tileId = tileId.replace(/[^A-Fa-f0-9-]/g, '');

    console.log(`${logPrefix} Received verified webhook for job ${jobId}, tile ${tileId}.`);

    const { status, payload: resultPayload, error: falError } = payload;
    let parentJobId: string | null = null;

    if (status === 'OK' && resultPayload) {
      console.log(`${logPrefix} Job ${jobId} completed successfully.`);
      
      const outputs = resultPayload?.outputs ?? {};
      const imageUrl = Object.values(outputs)
        .flatMap((node: any) => (node?.images || []).map((img: any) => img.url))
        .find(Boolean);

      if (!imageUrl) {
        throw new Error("No image URL found in webhook payload (checked all nodes).");
      }

      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) throw new Error(`Failed to download final image from Fal.ai: ${imageResponse.statusText}`);
      const imageBuffer = await imageResponse.arrayBuffer();

      const filePath = `${jobId}/${tileId}.png`;
      await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
      
      const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

      const updatePayload: any = {
          status: 'complete',
          generated_tile_bucket: GENERATED_IMAGES_BUCKET,
          generated_tile_path: filePath,
          generated_tile_url: publicUrl,
      };

      const { data: updatedTile, error: updateTileError } = await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update(updatePayload)
        .eq('id', tileId)
        .select('parent_job_id')
        .single();

      if (updateTileError) throw updateTileError;
      if (!updatedTile) throw new Error(`Tile row not found to update for tile_id: ${tileId}`);
      parentJobId = updatedTile.parent_job_id ?? null;
      
      await supabase
        .from('fal_comfyui_jobs')
        .update({ status: 'complete', final_result: resultPayload })
        .eq('id', jobId);

      console.log(`${logPrefix} Tile ${tileId} successfully finalized and stored at ${filePath}.`);

    } else {
      const logs = payload.logs || [];
      const logsString = logs.map((log: any) => `[${log.timestamp}] ${log.message}`).join('\n');
      const errorDetails = {
        status,
        error: falError ?? null,
        input: resultPayload?.input ?? payload?.input ?? null,
        validation: payload?.validation_errors ?? null
      };
      const errorMessage = `Fal.ai reported failure. Details: ${JSON.stringify(errorDetails)}. Logs:\n${logsString}`;
      console.error(`${logPrefix} Job ${jobId} failed: ${errorMessage}`);
      
      const { data: updatedTile, error: updateTileError } = await supabase
        .from('mira_agent_tiled_upscale_tiles')
        .update({ status: 'generation_failed', error_message: errorMessage })
        .eq('id', tileId)
        .select('parent_job_id')
        .single();
      
      if (updateTileError) throw updateTileError;
      if (!updatedTile) throw new Error(`Tile row not found to update for tile_id: ${tileId}`);
      parentJobId = updatedTile.parent_job_id ?? null;
      
      await supabase
        .from('fal_comfyui_jobs')
        .update({ status: 'failed', error_message: errorMessage })
        .eq('id', jobId);
    }

    if (parentJobId) {
        console.log(`${logPrefix} Performing ready-check for parent job ${parentJobId}...`);
        const { data: parentJob, error: parentJobError } = await supabase
            .from('mira_agent_tiled_upscale_jobs')
            .select('total_tiles, status')
            .eq('id', parentJobId)
            .single();

        if (parentJobError) throw parentJobError;
        if (!parentJob) throw new Error(`Parent job ${parentJobId} not found during ready-check.`);

        const { count: completedCount, error: countError } = await supabase
            .from('mira_agent_tiled_upscale_tiles')
            .select('*', { count: 'exact', head: true })
            .eq('parent_job_id', parentJobId)
            .eq('status', 'complete');
        
        if (countError) throw countError;

        console.log(`${logPrefix} Parent job ${parentJobId} status: ${parentJob.status}. Tiles: ${completedCount}/${parentJob.total_tiles} complete.`);

        if (parentJob.total_tiles > 0 && completedCount !== null && completedCount >= parentJob.total_tiles) {
            console.log(`${logPrefix} All tiles for job ${parentJobId} are complete. Attempting to trigger compositor.`);
            const { data: claimed, error: rpcError } = await supabase.rpc('try_set_job_to_compositing', { p_job_id: parentJobId });
            if (rpcError) {
                console.error(`${logPrefix} RPC try_set_job_to_compositing failed for job ${parentJobId}:`, rpcError.message);
            } else if (claimed) {
                console.log(`${logPrefix} Successfully claimed job ${parentJobId} via RPC. Invoking compositor.`);
                supabase.functions.invoke('MIRA-AGENT-compositor-tiled-upscale', { body: { parent_job_id: parentJobId } }).catch(console.error);
            } else {
                console.log(`${logPrefix} Job ${parentJobId} was already claimed by another instance. Skipping invocation.`);
            }
        }
    }

    return new Response(JSON.stringify({ success: true }), {
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