import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[BitStudioPoller][${job_id}] Invoked to check status.`);

  try {
    await supabase.from('mira-agent-bitstudio-jobs').update({ last_polled_at: new Date().toISOString() }).eq('id', job_id);
    console.log(`[BitStudioPoller][${job_id}] Heartbeat updated.`);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    console.log(`[BitStudioPoller][${job_id}] Fetched job from DB. Current status: ${job.status}, mode: ${job.mode}`);
    
    if (job.status === 'complete' || job.status === 'failed') {
        console.log(`[BitStudioPoller][${job.id}] Job already resolved. Halting check.`);
        return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const taskId = job.bitstudio_task_id;
    const statusUrl = `${BITSTUDIO_API_BASE}/images/${taskId}`;
    console.log(`[BitStudioPoller][${job.id}] Fetching status from BitStudio: ${statusUrl}`);
    const statusResponse = await fetch(statusUrl, {
      headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` }
    });

    if (!statusResponse.ok) throw new Error(`BitStudio status check failed: ${await statusResponse.text()}`);
    const statusData = await statusResponse.json();
    
    let jobStatus, finalImageUrl;

    if (job.mode === 'inpaint') {
        const versionIdToFind = job.metadata?.bitstudio_version_id;
        if (!versionIdToFind) throw new Error("Job is missing the version ID in its metadata.");
        const targetVersion = statusData.versions?.find((v: any) => v.id === versionIdToFind);
        if (!targetVersion) throw new Error(`Could not find version ${versionIdToFind} in the base image's version list.`);
        jobStatus = targetVersion.status;
        finalImageUrl = targetVersion.path;
    } else {
        jobStatus = statusData.status;
        finalImageUrl = statusData.path;
    }
    console.log(`[BitStudioPoller][${job.id}] BitStudio status: ${jobStatus}`);

    if (jobStatus === 'completed') {
      console.log(`[BitStudioPoller][${job.id}] Status is 'completed'.`);
      
      if (job.mode === 'inpaint') {
        console.log(`[BitStudioPoller][${job.id}] Inpaint job complete. Triggering compositor...`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
          status: 'compositing',
          final_image_url: finalImageUrl,
        }).eq('id', job_id);
        supabase.functions.invoke('MIRA-AGENT-compositor-inpaint', { body: { job_id } }).catch(console.error);
      } else {
        console.log(`[BitStudioPoller][${job.id}] VTO job complete. Finalizing...`);
        await supabase.from('mira-agent-bitstudio-jobs').update({
          status: 'complete',
          final_image_url: finalImageUrl,
        }).eq('id', job_id);
      }
      
      // If this job was part of a batch, update the parent pair job
      if (job.batch_pair_job_id) {
        console.log(`[BitStudioPoller][${job.id}] This job is part of batch pair ${job.batch_pair_job_id}. Updating parent.`);
        await supabase.from('mira-agent-batch-inpaint-pair-jobs')
          .update({ status: 'complete', final_image_url: finalImageUrl })
          .eq('id', job.batch_pair_job_id);
      }

      console.log(`[BitStudioPoller][${job.id}] Polling finished for this cycle.`);

    } else if (jobStatus === 'failed') {
      console.error(`[BitStudioPoller][${job.id}] Status is 'failed'. Updating job with error.`);
      const errorMessage = 'BitStudio processing failed.';
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'failed',
        error_message: errorMessage,
      }).eq('id', job_id);
      if (job.batch_pair_job_id) {
        await supabase.from('mira-agent-batch-inpaint-pair-jobs')
          .update({ status: 'failed', error_message: errorMessage })
          .eq('id', job.batch_pair_job_id);
      }
    } else {
      console.log(`[BitStudioPoller][${job.id}] Status is '${jobStatus}'. Updating status to 'processing' and awaiting next watchdog cycle.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'processing' }).eq('id', job_id);
    }

    return new Response(JSON.stringify({ success: true, status: jobStatus }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[BitStudioPoller][${job_id}] Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    if (job_id) { // Check if job_id is defined before trying to update the parent
        const { data: job } = await supabase.from('mira-agent-bitstudio-jobs').select('batch_pair_job_id').eq('id', job_id).single();
        if (job?.batch_pair_job_id) {
            await supabase.from('mira-agent-batch-inpaint-pair-jobs')
              .update({ status: 'failed', error_message: error.message })
              .eq('id', job.batch_pair_job_id);
        }
    }
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});