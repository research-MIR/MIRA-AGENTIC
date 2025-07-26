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
    const logPrefix = `[VTO-Refinement-Orchestrator][${pack_id}]`;
    console.log(`${logPrefix} Starting refinement pass for user ${user_id}.`);

    // 1. Fetch all completed, first-pass jobs for the pack
    const { data: firstPassJobs, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id, source_person_image_url, source_garment_image_url, final_image_url, metadata')
      .eq('vto_pack_job_id', pack_id)
      .eq('status', 'complete')
      .not('final_image_url', 'is', null)
      .or('metadata->>pass_number.is.null, metadata->>pass_number.neq.2');

    if (fetchError) throw new Error(`Failed to fetch first-pass jobs: ${fetchError.message}`);
    if (!firstPassJobs || firstPassJobs.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No completed first-pass jobs found to refine." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    console.log(`${logPrefix} Found ${firstPassJobs.length} jobs to refine.`);

    // 2. Create a new parent batch job to group this refinement pass
    const { data: batchJob, error: batchError } = await supabase
      .from('mira-agent-batch-inpaint-jobs')
      .insert({ user_id, status: 'processing', metadata: { total_pairs: firstPassJobs.length, source_vto_pack_id: pack_id } })
      .select('id')
      .single();
    
    if (batchError) throw batchError;
    const batchJobId = batchJob.id;
    console.log(`${logPrefix} Main refinement batch job ${batchJobId} created.`);

    // 3. Create the individual pair jobs for the inpainting pipeline
    const pairJobsToInsert = firstPassJobs.map(job => ({
      batch_job_id: batchJobId,
      user_id: user_id,
      status: 'pending',
      source_person_image_url: job.final_image_url, // Result of pass 1 is source for pass 2
      source_garment_image_url: job.source_garment_image_url,
      prompt_appendix: job.metadata?.prompt_appendix || "",
      metadata: {
        is_helper_enabled: job.metadata?.is_helper_enabled !== false,
        pass_number: 2,
        original_person_image_url_for_analysis: job.source_person_image_url,
        original_vto_job_id: job.id,
        vto_pack_job_id: pack_id, // Critical for linking back
      }
    }));

    const { error: pairsError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .insert(pairJobsToInsert);

    if (pairsError) throw pairsError;
    console.log(`${logPrefix} ${pairJobsToInsert.length} refinement pair jobs created and set to 'pending'.`);

    // 4. Asynchronously invoke the watchdog to start processing immediately
    supabase.functions.invoke('MIRA-AGENT-watchdog-background-jobs').catch(console.error);

    return new Response(JSON.stringify({ success: true, message: `${pairJobsToInsert.length} refinement jobs have been queued.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-Refinement-Orchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});