import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage, Canvas } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array | null, userId: string, filename: string): Promise<string | null> {
    if (!buffer) return null;
    const filePath = `${userId}/vto-debug/${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) {
        console.error(`Storage upload failed for ${filename}: ${error.message}`);
        throw new Error(`Storage upload failed for ${filename}: ${error.message}`);
    }
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return publicUrl;
}

function dilateMask(srcCanvas: Canvas, iterations: number): Canvas {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  let curr = srcCanvas;
  let buff = createCanvas(w, h);

  for (let i = 0; i < iterations; i++) {
    const bctx = buff.getContext('2d');
    bctx.clearRect(0, 0, w, h);
    bctx.drawImage(curr,  0,  0);
    bctx.drawImage(curr, -1,  0);
    bctx.drawImage(curr,  1,  0);
    bctx.drawImage(curr,  0, -1);
    bctx.drawImage(curr,  0,  1);

    const tmp = curr;
    curr = buff;
    buff = tmp;
  }
  return curr;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { raw_mask_url, user_id, parent_pair_job_id } = await req.json();
  if (!raw_mask_url || !user_id || !parent_pair_job_id) {
    throw new Error("raw_mask_url, user_id, and parent_pair_job_id are required.");
  }

  const requestId = `expander-${parent_pair_job_id}`;
  console.log(`[Expander][${requestId}] Function invoked.`);
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const response = await fetch(raw_mask_url);
    if (!response.ok) throw new Error(`Failed to download raw mask from ${raw_mask_url}`);
    const rawMaskBuffer = await response.arrayBuffer();
    const rawMaskImage = await loadImage(new Uint8Array(rawMaskBuffer));
    
    const width = rawMaskImage.width();
    const height = rawMaskImage.height();

    const rawMaskCanvas = createCanvas(width, height);
    rawMaskCanvas.getContext('2d').drawImage(rawMaskImage, 0, 0);

    const expansionPx = Math.max(1, Math.round(Math.min(width, height) * 0.06));
    console.log(`[Expander][${requestId}] Expanding mask by ${expansionPx}px.`);
    const expandedCanvas = dilateMask(rawMaskCanvas, expansionPx);

    const finalCanvas = createCanvas(width, height);
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.fillStyle = 'black';
    finalCtx.fillRect(0, 0, width, height);
    finalCtx.drawImage(expandedCanvas, 0, 0);

    const finalMaskBuffer = finalCanvas.toBuffer('image/png');
    const expandedMaskUrl = await uploadBufferToStorage(supabase, finalMaskBuffer, user_id, 'final_expanded_mask.png');
    if (!expandedMaskUrl) throw new Error("Failed to upload the final expanded mask.");
    console.log(`[Expander][${requestId}] Final expanded mask uploaded to: ${expandedMaskUrl}`);

    const { data: parentPairJob, error: parentFetchError } = await supabase
        .from('mira-agent-batch-inpaint-pair-jobs')
        .select('metadata')
        .eq('id', parent_pair_job_id)
        .single();

    if (parentFetchError) throw parentFetchError;

    const debug_assets = { raw_mask_url: raw_mask_url, expanded_mask_url: expandedMaskUrl };
    await supabase.from('mira-agent-batch-inpaint-pair-jobs')
        .update({ metadata: { ...parentPairJob.metadata, debug_assets } })
        .eq('id', parent_pair_job_id);

    console.log(`[Expander][${requestId}] Triggering Step 2 worker for parent job ${parent_pair_job_id}.`);
    await supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', {
        body: { pair_job_id: parent_pair_job_id, final_mask_url: expandedMaskUrl }
    });

    return new Response(JSON.stringify({ success: true, expandedMaskUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Expander][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});