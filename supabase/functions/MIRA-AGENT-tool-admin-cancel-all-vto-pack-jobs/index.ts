import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANCELLATION_REASON = "Cancelled by admin dev tool.";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[AdminCancelVtoPackJobs]`;
  console.log(`${logPrefix} Function invoked.`);

  try {
    let totalCancelled = 0;
    const results: { [key: string]: any } = {};

    // 1. Cancel BitStudio jobs linked to packs
    const { count: bitstudioCount, error: bitstudioError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .update({ status: 'failed', error_message: CANCELLATION_REASON })
      .not('vto_pack_job_id', 'is', null)
      .in('status', ['queued', 'processing', 'delegated', 'compositing', 'awaiting_fix', 'fixing', 'pending', 'segmenting', 'mask_expanded', 'processing_step_2']);
    if (bitstudioError) throw new Error(`Failed to cancel bitstudio jobs: ${bitstudioError.message}`);
    totalCancelled += bitstudioCount || 0;
    results['bitstudio_jobs'] = { cancelled: bitstudioCount || 0 };
    console.log(`${logPrefix} Cancelled ${bitstudioCount || 0} bitstudio jobs.`);

    // 2. Cancel QA reports
    const { count: qaCount, error: qaError } = await supabase
      .from('mira-agent-vto-qa-reports')
      .update({ status: 'failed', error_message: CANCELLATION_REASON })
      .in('status', ['pending', 'processing']);
    if (qaError) throw new Error(`Failed to cancel QA reports: ${qaError.message}`);
    totalCancelled += qaCount || 0;
    results['qa_reports'] = { cancelled: qaCount || 0 };
    console.log(`${logPrefix} Cancelled ${qaCount || 0} QA reports.`);

    // 3. Cancel report chunks
    const { count: chunkCount, error: chunkError } = await supabase
      .from('mira-agent-vto-report-chunks')
      .update({ status: 'failed', error_message: CANCELLATION_REASON })
      .in('status', ['pending', 'processing']);
    if (chunkError) throw new Error(`Failed to cancel report chunks: ${chunkError.message}`);
    totalCancelled += chunkCount || 0;
    results['report_chunks'] = { cancelled: chunkCount || 0 };
    console.log(`${logPrefix} Cancelled ${chunkCount || 0} report chunks.`);

    // 4. Cancel refinement pass jobs (batch and pair)
    // Find batch jobs linked to refinement packs
    const { data: refinementBatchJobs, error: fetchBatchError } = await supabase
        .from('mira-agent-batch-inpaint-jobs')
        .select('id')
        .not('metadata->>refinement_vto_pack_id', 'is', null)
        .in('status', ['pending', 'processing']);
    if (fetchBatchError) throw new Error(`Failed to fetch refinement batch jobs: ${fetchBatchError.message}`);

    if (refinementBatchJobs && refinementBatchJobs.length > 0) {
        const batchJobIds = refinementBatchJobs.map(j => j.id);
        
        // Cancel pair jobs
        const { count: pairCount, error: pairError } = await supabase
            .from('mira-agent-batch-inpaint-pair-jobs')
            .update({ status: 'failed', error_message: CANCELLATION_REASON })
            .in('batch_job_id', batchJobIds)
            .in('status', ['pending', 'processing', 'segmenting', 'delegated', 'mask_expanded', 'processing_step_2']);
        if (pairError) throw new Error(`Failed to cancel refinement pair jobs: ${pairError.message}`);
        totalCancelled += pairCount || 0;
        results['refinement_pair_jobs'] = { cancelled: pairCount || 0 };
        console.log(`${logPrefix} Cancelled ${pairCount || 0} refinement pair jobs.`);

        // Cancel batch jobs
        const { count: batchCount, error: batchUpdateError } = await supabase
            .from('mira-agent-batch-inpaint-jobs')
            .update({ status: 'failed' })
            .in('id', batchJobIds);
        if (batchUpdateError) throw new Error(`Failed to cancel refinement batch jobs: ${batchUpdateError.message}`);
        totalCancelled += batchCount || 0;
        results['refinement_batch_jobs'] = { cancelled: batchCount || 0 };
        console.log(`${logPrefix} Cancelled ${batchCount || 0} refinement batch jobs.`);
    }

    // 5. Update parent packs
    const { count: packCount, error: packError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .update({ synthesis_report: `# Analysis Cancelled\n\nAll active jobs in this pack were cancelled by an administrator.` })
      .neq('synthesis_report', null); // A way to find "active" packs, maybe not perfect
    if (packError) console.warn(`${logPrefix} Could not update parent packs: ${packError.message}`);
    results['vto_packs'] = { updated: packCount || 0 };
    console.log(`${logPrefix} Updated ${packCount || 0} parent VTO packs.`);

    const message = `Successfully cancelled ${totalCancelled} active job(s) across all VTO packs.`;
    console.log(`${logPrefix} ${message}`, results);

    return new Response(JSON.stringify({ success: true, message, details: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});