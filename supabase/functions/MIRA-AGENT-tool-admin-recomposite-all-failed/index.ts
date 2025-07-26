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
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[AdminRecompositeAll]`;
    console.log(`${logPrefix} Function invoked.`);

    // 1. Find all failed jobs that are eligible for recompositing
    const { data: failedJobs, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id, final_image_url')
      .eq('status', 'failed')
      .not('final_image_url', 'is', null) // This is the patch URL
      .not('metadata->>full_source_image_url', 'is', null)
      .not('metadata->>bbox', 'is', null)
      .not('metadata->>final_mask_url', 'is', null);

    if (fetchError) throw new Error(`Failed to fetch eligible jobs: ${fetchError.message}`);

    if (!failedJobs || failedJobs.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No failed jobs found that are eligible for recompositing." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }
    console.log(`${logPrefix} Found ${failedJobs.length} jobs to re-composite.`);

    // 2. Update their status to 'compositing' to prevent re-runs
    const jobIdsToUpdate = failedJobs.map(j => j.id);
    const { error: updateError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .update({ status: 'compositing', error_message: 'Re-compositing initiated by admin.' })
      .in('id', jobIdsToUpdate);

    if (updateError) throw new Error(`Failed to update job statuses: ${updateError.message}`);

    // 3. Asynchronously invoke the compositor for each job
    const compositorPromises = failedJobs.map(job =>
      supabase.functions.invoke('MIRA-AGENT-compositor-inpaint', {
        body: {
          job_id: job.id,
          final_image_url: job.final_image_url,
          job_type: 'bitstudio'
        }
      })
    );

    Promise.allSettled(compositorPromises).then(results => {
        const failedInvocations = results.filter(r => r.status === 'rejected');
        if (failedInvocations.length > 0) {
            console.error(`${logPrefix} Failed to invoke the compositor for ${failedInvocations.length} jobs.`);
        } else {
            console.log(`${logPrefix} All ${failedJobs.length} compositor workers invoked successfully.`);
        }
    });

    const message = `Successfully re-queued ${failedJobs.length} jobs for compositing.`;
    return new Response(JSON.stringify({ success: true, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[AdminRecompositeAll] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});