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

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[BitStudioPoller-Batch]`;
  console.log(`${logPrefix} Poller invoked. Attempting to claim a batch of jobs.`);

  try {
    // Atomically claim a batch of jobs to process by updating their timestamp and returning them.
    const { data: jobsToProcess, error: claimError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .update({ last_polled_at: new Date().toISOString() })
      .in('status', ['queued', 'processing'])
      .not('bitstudio_task_id', 'is', null)
      .select('*')
      .limit(BATCH_SIZE);

    if (claimError) {
      console.error(`${logPrefix} Error claiming jobs:`, claimError);
      throw claimError;
    }

    if (!jobsToProcess || jobsToProcess.length === 0) {
      console.log(`${logPrefix} No active jobs to process. Exiting.`);
      return new Response(JSON.stringify({ success: true, message: "No active jobs found." }), { headers: corsHeaders });
    }

    console.log(`${logPrefix} Claimed ${jobsToProcess.length} job(s). Processing batch...`);

    const processingPromises = jobsToProcess.map(async (job) => {
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
        } else {
          await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'processing' }).eq('id', job.id);
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