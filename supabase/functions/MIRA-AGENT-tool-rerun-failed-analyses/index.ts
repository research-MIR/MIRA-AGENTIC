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

  try {
    const { pack_id, user_id } = await req.json();
    if (!pack_id || !user_id) {
      throw new Error("pack_id and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[RerunFailedAnalyses][${pack_id}]`;
    console.log(`${logPrefix} Function invoked by user ${user_id}.`);

    // Call the new, robust database function
    const { data: failedReports, error: rpcError } = await supabase
      .rpc('get_rerunnable_qa_reports_for_pack', {
        p_pack_id: pack_id,
        p_user_id: user_id
      });

    if (rpcError) throw new Error(`Failed to fetch failed reports via RPC: ${rpcError.message}`);

    if (!failedReports || failedReports.length === 0) {
      console.log(`${logPrefix} No 'Unknown' failed analyses found to rerun.`);
      return new Response(JSON.stringify({ success: true, message: "No 'Unknown' failed analyses found to rerun." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const reportIdsToRerun = failedReports.map(r => r.report_id);
    console.log(`${logPrefix} Found ${reportIdsToRerun.length} reports to rerun with IDs:`, reportIdsToRerun);

    // Reset the status of these reports
    const { error: updateError } = await supabase
      .from('mira-agent-vto-qa-reports')
      .update({ status: 'pending', error_message: null, comparative_report: null })
      .in('id', reportIdsToRerun);

    if (updateError) throw new Error(`Failed to reset reports: ${updateError.message}`);
    console.log(`${logPrefix} Successfully reset ${reportIdsToRerun.length} reports to 'pending'.`);

    // Asynchronously invoke the worker for each reset report
    const workerPromises = reportIdsToRerun.map(qa_job_id =>
      supabase.functions.invoke('MIRA-AGENT-worker-vto-reporter', {
        body: { qa_job_id }
      })
    );

    Promise.allSettled(workerPromises).then(results => {
        const failedInvocations = results.filter(r => r.status === 'rejected');
        if (failedInvocations.length > 0) {
            console.error(`${logPrefix} Failed to invoke the worker for ${failedInvocations.length} jobs.`);
        } else {
            console.log(`${logPrefix} All ${reportIdsToRerun.length} workers invoked successfully.`);
        }
    });

    const message = `Successfully re-queued ${reportIdsToRerun.length} failed analysis jobs.`;
    return new Response(JSON.stringify({ success: true, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[RerunFailedAnalyses] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});