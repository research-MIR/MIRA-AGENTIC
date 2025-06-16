import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  const { job_id } = await req.json();
  if (!job_id) return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-vto-pipeline-jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;

    switch (job.status) {
      case 'pending_segmentation': {
        const { data: segmentationJob, error } = await supabase.functions.invoke('MIRA-AGENT-proxy-segmentation', {
          body: {
            person_image_url: job.source_person_image_url,
            garment_image_url: job.source_garment_image_url,
            user_id: job.user_id
          }
        });
        if (error) throw error;
        // The segmentation worker will update its own status. We need to poll or use a trigger.
        // For now, we assume a separate mechanism will re-trigger this worker once segmentation is done.
        // A better approach would be for the segmentation worker to call back.
        // Let's assume for now the segmentation poller will re-trigger this.
        // To simplify, let's make the segmentation worker synchronous for the pipeline.
        const { data: segResult, error: segError } = await supabase.functions.invoke('MIRA-AGENT-worker-segmentation', {
            body: { job_id: segmentationJob.jobId }
        });
        if(segError) throw segError;

        await supabase.from('mira-agent-vto-pipeline-jobs').update({
            status: 'pending_crop',
            segmentation_result: segResult.result
        }).eq('id', job_id);
        supabase.functions.invoke('MIRA-AGENT-worker-vto-pipeline', { body: { job_id } });
        break;
      }
      // ... other cases will be added here
      default:
        console.log(`[VTO Worker] Job ${job_id} has unhandled status: ${job.status}`);
    }

    return new Response(JSON.stringify({ success: true, message: `Handled status ${job.status}` }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[VTO Worker][${job_id}] Error:`, error);
    await supabase.from('mira-agent-vto-pipeline-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});