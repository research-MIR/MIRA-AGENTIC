import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  const { fixer_job_id } = await req.json();
  if (!fixer_job_id) throw new Error("fixer_job_id is required.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[FixerExecutor][${fixer_job_id}] Invoked.`);

  try {
    const { data: fixerJob, error: fetchError } = await supabase
      .from('mira-agent-fixer-jobs')
      .select('*, source_vto_job:mira-agent-bitstudio-jobs(*)')
      .eq('id', fixer_job_id)
      .single();
    if (fetchError) throw fetchError;

    const plan = fixerJob.repair_plan;
    if (!plan || !plan.action) throw new Error("No valid repair plan found in the job.");

    await supabase.from('mira-agent-fixer-jobs').update({ status: 'executing_step' }).eq('id', fixer_job_id);

    switch (plan.action) {
      case 'retry_with_new_parameters': {
        const sourceJob = fixerJob.source_vto_job;
        const newParams = plan.parameters;
        
        // Re-queue the job with new parameters
        const { error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
          body: {
            ...sourceJob.metadata, // Start with original metadata
            user_id: sourceJob.user_id,
            mode: sourceJob.mode,
            prompt_appendix: newParams.prompt_appendix || sourceJob.metadata.prompt_appendix,
            denoise: newParams.denoise_value || sourceJob.metadata.denoise,
            // Pass original URLs
            source_image_url: sourceJob.source_person_image_url,
            garment_image_url: sourceJob.source_garment_image_url,
            mask_image_url: sourceJob.metadata.mask_image_url,
            // Link to the fixer job for tracking
            fixer_job_id: fixer_job_id,
          }
        });
        if (proxyError) throw proxyError;

        await supabase.from('mira-agent-fixer-jobs').update({ status: 'awaiting_new_vto' }).eq('id', fixer_job_id);
        console.log(`[FixerExecutor][${fixer_job_id}] Re-queued VTO job with new parameters.`);
        break;
      }
      case 'give_up': {
        await supabase.from('mira-agent-fixer-jobs').update({ status: 'failed' }).eq('id', fixer_job_id);
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'permanently_failed', error_message: plan.parameters.reason }).eq('id', fixerJob.source_vto_job_id);
        console.log(`[FixerExecutor][${fixer_job_id}] Agent gave up. Reason: ${plan.parameters.reason}`);
        break;
      }
      default:
        throw new Error(`Unknown plan action: ${plan.action}`);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[FixerExecutor][${fixer_job_id}] Error:`, error);
    await supabase.from('mira-agent-fixer-jobs').update({ status: 'failed' }).eq('id', fixer_job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});