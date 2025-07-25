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

    // Security Check: Verify user owns the pack
    const { data: packOwner, error: ownerError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .select('user_id')
      .eq('id', pack_id)
      .single();

    if (ownerError) throw new Error(`Could not verify pack ownership: ${ownerError.message}`);
    if (packOwner.user_id !== user_id) {
      throw new Error("Permission denied: You do not own this pack.");
    }

    // Find failed reports with 'Unknown' or NULL failure category
    console.log(`${logPrefix} Searching for failed reports where failure_category is NULL or 'Unknown'.`);
    const { data: failedReports, error: fetchError } = await supabase
      .from('mira-agent-vto-qa-reports')
      .select('id')
      .eq('vto_pack_job_id', pack_id)
      .eq('status', 'failed')
      .or('comparative_report->>failure_category.is.null,comparative_report->>failure_category.eq.Unknown');

    if (fetchError) throw new Error(`Failed to fetch failed reports: ${fetchError.message}`);

    if (!failedReports || failedReports.length === 0) {
      console.log(`${logPrefix} No 'Unknown' failed analyses found to rerun.`);
      return new Response(JSON.stringify({ success: true, message: "No 'Unknown' failed analyses found to rerun." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const reportIdsToRerun = failedReports.map(r => r.id);
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

    // We don't await these, just log if any invocation fails
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