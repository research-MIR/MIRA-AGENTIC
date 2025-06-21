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
const POLLING_INTERVAL_MS = 3000; // 3 seconds
const GENERATED_IMAGES_BUCKET = 'mira-generations';

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) { throw new Error("job_id is required."); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[BitStudioPoller][${job_id}] Invoked to check status.`);

  try {
    // HEARTBEAT: Mark the job as being polled right now to prevent watchdog conflicts
    await supabase.from('mira-agent-bitstudio-jobs').update({ last_polled_at: new Date().toISOString() }).eq('id', job_id);
    console.log(`[BitStudioPoller][${job_id}] Heartbeat updated.`);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job: ${fetchError.message}`);
    console.log(`[BitStudioPoller][${job_id}] Fetched job from DB. Current status: ${job.status}`);
    
    if (job.status === 'complete' || job.status === 'failed') {
        console.log(`[BitStudioPoller][${job.id}] Job already resolved. Halting check.`);
        return new Response(JSON.stringify({ success: true, message: "Job already resolved." }), { headers: corsHeaders });
    }

    const statusUrl = `${BITSTUDIO_API_BASE}/images/${job.bitstudio_task_id}`;
    console.log(`[BitStudioPoller][${job_id}] Fetching status from BitStudio: ${statusUrl}`);
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
        console.log(`[BitStudioPoller][${job.id}] Inpaint version status: ${jobStatus}`);
    } else {
        jobStatus = statusData.status;
        finalImageUrl = statusData.path;
        console.log(`[BitStudioPoller][${job.id}] VTO job status: ${jobStatus}`);
    }

    if (jobStatus === 'completed') {
      console.log(`[BitStudioPoller][${job.id}] Status is 'completed'. Downloading final image from: ${finalImageUrl}`);
      
      const imageResponse = await fetch(finalImageUrl);
      if (!imageResponse.ok) throw new Error(`Failed to download final image from BitStudio URL: ${finalImageUrl}`);
      const imageBuffer = await imageResponse.arrayBuffer();
      console.log(`[BitStudioPoller][${job.id}] Download complete. Uploading to Supabase Storage...`);

      const filePath = `${job.user_id}/${Date.now()}_vto_${job.id.substring(0, 8)}.png`;
      const { error: uploadError } = await supabase.storage
        .from(GENERATED_IMAGES_BUCKET)
        .upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
      
      if (uploadError) throw new Error(`Failed to upload final image to Supabase Storage: ${uploadError.message}`);
      
      const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
      console.log(`[BitStudioPoller][${job.id}] Upload complete. New persistent URL: ${publicUrl}`);

      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'complete',
        final_image_url: publicUrl, // Save our own persistent URL
      }).eq('id', job_id);
      console.log(`[BitStudioPoller][${job.id}] Job finalized in DB.`);

    } else if (jobStatus === 'failed') {
      console.error(`[BitStudioPoller][${job.id}] Status is 'failed'. Updating job with error.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'failed',
        error_message: 'BitStudio processing failed.',
      }).eq('id', job_id);
    } else {
      console.log(`[BitStudioPoller][${job.id}] Status is '${jobStatus}'. Re-polling in ${POLLING_INTERVAL_MS}ms.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'processing' }).eq('id', job_id);
      setTimeout(() => {
        supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id } }).catch(console.error);
      }, POLLING_INTERVAL_MS);
    }

    return new Response(JSON.stringify({ success: true, status: jobStatus }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[BitStudioPoller][${job_id}] Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});