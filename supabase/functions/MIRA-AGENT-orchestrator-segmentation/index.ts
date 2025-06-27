import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const NUM_WORKERS = 5;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  const requestId = `segment-orchestrator-${Date.now()}`;
  console.log(`[Orchestrator][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  let aggregationJobId: string | null = null;

  try {
    const body = await req.json();
    console.log(`[Orchestrator][${requestId}] Received body with keys:`, Object.keys(body));
    const { image_base64, mime_type, reference_image_base64, reference_mime_type, user_id, image_dimensions } = body;

    if (!user_id || !image_base64 || !mime_type || !image_dimensions) {
      console.error(`[Orchestrator][${requestId}] Validation failed. user_id: ${!!user_id}, image_base64: ${!!image_base64}, mime_type: ${!!mime_type}, image_dimensions: ${!!image_dimensions}`);
      throw new Error("Missing required parameters for new job.");
    }

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .insert({ 
          user_id, 
          status: 'aggregating',
          source_image_dimensions: image_dimensions,
          source_image_base64: image_base64, // Directly use the base64 from the client
          results: [] 
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    aggregationJobId = newJob.id;
    console.log(`[Orchestrator][${requestId}] Aggregation job ${aggregationJobId} created.`);

    const workerPromises = [];
    for (let i = 0; i < NUM_WORKERS; i++) {
        console.log(`[Orchestrator][${requestId}] Dispatching worker ${i + 1}/${NUM_WORKERS}...`);
        const promise = supabase.functions.invoke('MIRA-AGENT-worker-segmentation', {
            body: {
                aggregation_job_id: aggregationJobId,
                mime_type: 'image/png', // Client now guarantees PNG
                reference_image_base64,
                reference_mime_type,
            }
        });
        workerPromises.push(promise);
    }

    Promise.allSettled(workerPromises).then(results => {
        const failedInvocations = results.filter(r => r.status === 'rejected');
        if (failedInvocations.length > 0) {
            console.error(`[Orchestrator][${requestId}] Failed to invoke ${failedInvocations.length} workers.`);
        } else {
            console.log(`[Orchestrator][${requestId}] All ${NUM_WORKERS} workers invoked successfully.`);
        }
    });

    return new Response(JSON.stringify({ success: true, message: `Segmentation job started with ${NUM_WORKERS} workers.`, aggregationJobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Orchestrator][${requestId}] Error:`, error);
    if (aggregationJobId) {
        await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', aggregationJobId);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});