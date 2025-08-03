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
    const logPrefix = `[RetryAllFailed][${pack_id}]`;
    console.log(`${logPrefix} Function invoked by user ${user_id}.`);

    // Security check: Ensure user owns the pack
    const { data: packOwner, error: ownerError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .select('user_id')
      .eq('id', pack_id)
      .single();

    if (ownerError) throw new Error(`Could not verify pack ownership: ${ownerError.message}`);
    if (packOwner.user_id !== user_id) throw new Error("Permission denied: You do not own this pack.");

    // Find all failed jobs in the pack that have the necessary metadata to be retried
    const { data: failedJobs, error: fetchError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('id, metadata')
      .eq('metadata->>vto_pack_job_id', pack_id)
      .in('status', ['failed', 'permanently_failed']);

    if (fetchError) throw new Error(`Failed to fetch failed jobs: ${fetchError.message}`);

    if (!failedJobs || failedJobs.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No failed jobs found in this pack to retry." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const jobsToRetry = failedJobs.filter(job => job.metadata?.debug_assets?.expanded_mask_url);
    const jobsWithoutMask = failedJobs.filter(job => !job.metadata?.debug_assets?.expanded_mask_url);

    if (jobsToRetry.length === 0) {
        return new Response(JSON.stringify({ success: true, message: `Found ${jobsWithoutMask.length} failed jobs, but none are eligible for retry (missing expanded mask).` }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    console.log(`${logPrefix} Found ${jobsToRetry.length} eligible jobs to retry.`);
    if (jobsWithoutMask.length > 0) {
        console.log(`${logPrefix} Skipping ${jobsWithoutMask.length} jobs that are missing the required mask for retry.`);
    }

    const jobIdsToReset = jobsToRetry.map(j => j.id);

    // Bulk update status to 'mask_expanded'
    const { error: updateError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .update({ status: 'mask_expanded', error_message: null })
      .in('id', jobIdsToReset);

    if (updateError) throw new Error(`Failed to reset job statuses: ${updateError.message}`);
    console.log(`${logPrefix} Successfully reset ${jobIdsToReset.length} jobs to 'mask_expanded'.`);

    // Asynchronously invoke the worker for each reset job
    const workerPromises = jobsToRetry.map(job =>
      supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint-step2', {
        body: { 
            pair_job_id: job.id, 
            final_mask_url: job.metadata.debug_assets.expanded_mask_url 
        }
      })
    );

    Promise.allSettled(workerPromises).then(results => {
        const failedInvocations = results.filter(r => r.status === 'rejected');
        if (failedInvocations.length > 0) {
            console.error(`${logPrefix} Failed to invoke the worker for ${failedInvocations.length} jobs.`);
        } else {
            console.log(`${logPrefix} All ${jobsToRetry.length} workers invoked successfully.`);
        }
    });

    const message = `Successfully re-queued ${jobsToRetry.length} failed jobs for processing.`;
    return new Response(JSON.stringify({ success: true, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[RetryAllFailed] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});