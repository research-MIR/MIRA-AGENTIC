import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';
const BATCH_SIZE = 10; // Process up to 10 jobs per invocation
const STALLED_THRESHOLD_SECONDS = 60; // A job is stalled if not polled for this long

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[BitStudioPoller-Autonomous]`;
  console.log(`${logPrefix} Poller invoked.`);

  try {
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_SECONDS * 1000).toISOString();

    // Step 1: Find candidate jobs directly.
    // A job is a candidate if it's new ('queued') OR if it's been processing for too long.
    const { data: jobsToProcess, error: selectError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('*')
      .filter('bitstudio_task_id', 'isnot', null)
      .or(`status.eq.queued,and(status.in.("processing","delegated"),last_polled_at.lt.${threshold})`)
      .limit(BATCH_SIZE);

    if (selectError) {
      console.error(`${logPrefix} Error selecting jobs to process:`, selectError);
      throw selectError;
    }

    if (!jobsToProcess || jobsToProcess.length === 0) {
      console.log(`${logPrefix} No active or stalled jobs to process. Exiting.`);
      return new Response(JSON.stringify({ success: true, message: "No active jobs found." }), { headers: corsHeaders });
    }

    console.log(`${logPrefix} Found ${jobsToProcess.length} job(s) to process. Processing batch...`);

    // Step 2: Update timestamps for all claimed jobs AT ONCE before processing.
    const jobIds = jobsToProcess.map(j => j.id);
    await supabase
        .from('mira-agent-bitstudio-jobs')
        .update({ last_polled_at: new Date().toISOString() })
        .in('id', jobIds);

    const processingPromises = jobsToProcess.map(async (job: any) => {
      const jobLogPrefix = `[BitStudioPoller][${job.id}]`;
      try {
        let statusUrl;
        if (job.mode === 'inpaint') {
            const baseImageId = job.bitstudio_person_image_id;
            if (!baseImageId) throw new Error("Inpaint job is missing the base image ID (bitstudio_person_image_id).");
            statusUrl = `${BITSTUDIO_API_BASE}/images/${baseImageId}`;
        } else {
            const taskId = job.bitstudio_task_id;
            if (!taskId) throw new Error("Job is missing the task ID (bitstudio_task_id).");
            statusUrl = `${BITSTUDIO_API_BASE}/images/${taskId}`;
        }
        const statusResponse = await fetch(statusUrl, {
          headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` }
        });

        if (!statusResponse.ok) throw new Error(`BitStudio status check failed: ${await statusResponse.text()}`);
        const statusData = await statusResponse.json();
        
        let jobStatus, finalImageUrl;

        if (job.mode === 'inpaint') {
            const versionIdToFind = job.bitstudio_task_id;
            if (!versionIdToFind) throw new Error("Inpaint job is missing the version ID (bitstudio_task_id).");
            
            const targetVersion = statusData.versions?.find((v: any) => v.id === versionIdToFind);
            if (!targetVersion) throw new Error(`Could not find version ${versionIdToFind} in the base image's version list.`);
            
            jobStatus = targetVersion.status;
            finalImageUrl = targetVersion.path;
        } else {
            jobStatus = statusData.status;
            finalImageUrl = statusData.path;
        }
        console.log(`${jobLogPrefix} BitStudio status: ${jobStatus}`);

        if (jobStatus === 'completed') {
          if (job.mode === 'inpaint') {
            await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'compositing', final_image_url: finalImageUrl }).eq('id', job.id);
            supabase.functions.invoke('MIRA-AGENT-compositor-inpaint', { body: { job_id: job.id, final_image_url: finalImageUrl, job_type: 'bitstudio' } }).catch(console.error);
          } else {
            await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'complete', final_image_url: finalImageUrl }).eq('id', job.id);
          }
          if (job.batch_pair_job_id) {
            await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({ status: 'complete', final_image_url: finalImageUrl }).eq('id', job.batch_pair_job_id);
          }
        } else if (jobStatus === 'failed') {
          const errorMessage = 'BitStudio processing failed.';
          await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', job.id);
          if (job.batch_pair_job_id) {
            await supabase.from('mira-agent-batch-inpaint-pair-jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', job.batch_pair_job_id);
          }
        } else if (jobStatus === 'processing') {
            await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'processing' }).eq('id', job.id);
        } else if (jobStatus === 'pending') {
            console.log(`${jobLogPrefix} Job is still pending in BitStudio's queue. No status change needed. Watchdog will re-check.`);
        }
      } catch (error) {
        console.error(`${jobLogPrefix} Error processing job:`, error);
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job.id);
      }
    });
    await Promise.allSettled(processingPromises);
    console.log(`${logPrefix} Batch processing complete.`);

    return new Response(JSON.stringify({ success: true, processedCount: jobsToProcess.length }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});