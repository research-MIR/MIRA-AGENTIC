import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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

  const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type, user_id, image_dimensions } = await req.json();
  const requestId = `segment-orchestrator-${Date.now()}`;
  console.log(`[Orchestrator][${requestId}] Invoked.`);

  try {
    if (!user_id || !image_base64 || !mime_type || !prompt || !image_dimensions) {
      throw new Error("Missing required parameters: user_id, image_base64, mime_type, prompt, and image_dimensions are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    console.log(`[Orchestrator][${requestId}] Creating aggregation job record in DB...`);
    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .insert({
        user_id: user_id,
        status: 'aggregating',
        source_image_dimensions: image_dimensions,
        results: [],
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    const aggregation_job_id = newJob.id;
    console.log(`[Orchestrator][${requestId}] Aggregation job ${aggregation_job_id} created.`);

    const workerPayload = {
      image_base64,
      mime_type,
      prompt,
      reference_image_base64,
      reference_mime_type,
      aggregation_job_id,
    };

    console.log(`[Orchestrator][${requestId}] Invoking 6 segmentation workers asynchronously...`);
    const workerPromises = Array.from({ length: 6 }).map(() => 
      supabase.functions.invoke('MIRA-AGENT-tool-segment-image', { body: workerPayload })
    );

    Promise.allSettled(workerPromises).then(results => {
        const failedCount = results.filter(r => r.status === 'rejected').length;
        if (failedCount > 0) {
            console.warn(`[Orchestrator][${requestId}] ${failedCount} worker invocations failed.`);
        } else {
            console.log(`[Orchestrator][${requestId}] All 6 workers invoked successfully.`);
        }
    });

    return new Response(JSON.stringify({ success: true, aggregation_job_id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Orchestrator][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});