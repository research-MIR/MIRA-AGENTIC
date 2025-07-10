import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CANCELLATION_REASON = "System-wide shutdown initiated by admin.";

serve(async (req) => {
  const requestId = `shutdown-all-${Date.now()}`;
  console.log(`[AdminShutdownAllJobs][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    let totalCancelled = 0;
    const results: { [key: string]: any } = {};

    const jobTables = [
      { name: 'mira-agent-jobs', statuses: ['processing', 'awaiting_feedback', 'awaiting_refinement', 'queued'] },
      { name: 'mira-agent-comfyui-jobs', statuses: ['queued', 'processing'] },
      { name: 'mira-agent-bitstudio-jobs', statuses: ['queued', 'processing', 'delegated', 'compositing'] },
      { name: 'mira-agent-batch-inpaint-pair-jobs', statuses: ['pending', 'segmenting', 'delegated'] },
      { name: 'mira-agent-mask-aggregation-jobs', statuses: ['aggregating', 'compositing'] },
      { name: 'mira-agent-model-generation-jobs', statuses: ['pending', 'base_generation_complete', 'awaiting_approval', 'generating_poses', 'polling_poses', 'upscaling_poses'] }
    ];

    for (const table of jobTables) {
      console.log(`[AdminShutdownAllJobs][${requestId}] Cancelling jobs in table: ${table.name}`);
      const { count, error } = await supabase
        .from(table.name)
        .update({ status: 'failed', error_message: CANCELLATION_REASON })
        .in('status', table.statuses);

      if (error) {
        console.error(`[AdminShutdownAllJobs][${requestId}] Error cancelling jobs in ${table.name}:`, error);
        results[table.name] = { error: error.message };
      } else {
        console.log(`[AdminShutdownAllJobs][${requestId}] Cancelled ${count || 0} jobs in ${table.name}.`);
        results[table.name] = { cancelled: count || 0 };
        totalCancelled += count || 0;
      }
    }

    const message = `Shutdown complete. Total jobs cancelled: ${totalCancelled}.`;
    console.log(`[AdminShutdownAllJobs][${requestId}] ${message}`, results);

    return new Response(JSON.stringify({ success: true, message, details: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[AdminShutdownAllJobs][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});