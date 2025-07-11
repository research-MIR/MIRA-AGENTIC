import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required for the fixer-executor.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[FixerExecutor][${job_id}]`;
  console.log(`${logPrefix} Invoked.`);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('*')
      .eq('id', job_id)
      .single();
    if (fetchError) throw fetchError;

    const plan = job.metadata?.current_fix_plan;
    if (!plan || !plan.action) throw new Error("No valid repair plan found in the job metadata.");

    const originalFailedJobId = job.metadata?.original_job_id || job.id;
    console.log(`${logPrefix} This is part of a retry chain for original job: ${originalFailedJobId}.`);

    console.log(`${logPrefix} Executing plan action: ${plan.action}`);

    switch (plan.action) {
      case 'retry_with_new_parameters': {
        const newParams = plan.parameters;
        console.log(`${logPrefix} Preparing to retry job with new parameters:`, newParams);

        const currentRetryCount = job.metadata?.retry_count || 0;
        console.log(`${logPrefix} Current retry count is ${currentRetryCount}. Incrementing...`);
        
        const newMetadata = {
            ...job.metadata,
            retry_count: currentRetryCount + 1,
        };
        const { error: updateError } = await supabase
            .from('mira-agent-bitstudio-jobs')
            .update({ metadata: newMetadata })
            .eq('id', job_id);
        if (updateError) throw new Error(`Failed to update retry count: ${updateError.message}`);
        console.log(`${logPrefix} Incremented retry count to ${newMetadata.retry_count}.`);
        
        const { error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
          body: {
            user_id: job.user_id,
            mode: job.mode,
            source_image_url: job.source_person_image_url,
            reference_image_url: job.source_garment_image_url,
            mask_image_url: job.metadata.mask_image_url,
            prompt_appendix: newParams.prompt_appendix,
            retry_job_id: job.id,
          }
        });
        if (proxyError) throw proxyError;

        console.log(`${logPrefix} Successfully re-queued VTO job via proxy.`);
        break;
      }
      case 'give_up': {
        await supabase.from('mira-agent-bitstudio-jobs')
          .update({ 
            status: 'permanently_failed', 
            error_message: plan.parameters.reason 
          })
          .eq('id', job.id);
        console.log(`${logPrefix} Agent gave up. Reason: ${plan.parameters.reason}. Job marked as permanently_failed.`);
        break;
      }
      default:
        throw new Error(`Unknown plan action: ${plan.action}`);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Fixer executor failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});