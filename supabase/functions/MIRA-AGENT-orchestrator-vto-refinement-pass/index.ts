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
    const { source_pack_id, user_id, job_ids_to_refine } = await req.json();
    if (!source_pack_id || !user_id || !job_ids_to_refine || !Array.isArray(job_ids_to_refine)) {
      throw new Error("source_pack_id, user_id, and a job_ids_to_refine array are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[VTO-Refinement-Orchestrator][${source_pack_id}]`;
    console.log(`${logPrefix} Starting refinement pass for user ${user_id}.`);

    // --- RESET LOGIC ---
    console.log(`${logPrefix} Calling RPC to reset any existing refinement pass...`);
    const { error: resetError } = await supabase.rpc('MIRA-AGENT-admin-reset-vto-refinement-pass', {
        p_source_pack_id: source_pack_id,
        p_user_id: user_id
    });
    if (resetError) {
        console.error(`${logPrefix} Failed to reset existing refinement pass:`, resetError);
        throw new Error(`Failed to reset existing refinement pass: ${resetError.message}`);
    }
    console.log(`${logPrefix} Reset complete. Proceeding to create new pass.`);
    // --- END OF RESET LOGIC ---

    // 1. Fetch the original pack to get its name
    const { data: sourcePack, error: sourcePackError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .select('metadata')
      .eq('id', source_pack_id)
      .single();
    if (sourcePackError) throw new Error(`Failed to fetch source pack details: ${sourcePackError.message}`);
    const sourcePackName = sourcePack.metadata?.name || `Pack ${source_pack_id.substring(0, 8)}`;

    // 2. Fetch the specific jobs to refine using the provided IDs
    const { data: jobsToRefine, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id, source_person_image_url, source_garment_image_url, final_image_url, metadata')
      .in('id', job_ids_to_refine);

    if (fetchError) throw new Error(`Failed to fetch jobs to refine: ${fetchError.message}`);
    if (!jobsToRefine || jobsToRefine.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No valid jobs found to refine from the provided list." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    console.log(`${logPrefix} Found ${jobsToRefine.length} jobs to refine.`);

    // 3. Create a NEW VTO pack for the refinement pass
    const { data: newPack, error: newPackError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .insert({
        user_id,
        metadata: {
          name: `[Refined] ${sourcePackName}`,
          total_pairs: jobsToRefine.length,
          engine: 'bitstudio_inpaint',
          refinement_of_pack_id: source_pack_id
        }
      })
      .select('id')
      .single();
    if (newPackError) throw newPackError;
    const newVtoPackJobId = newPack.id;
    console.log(`${logPrefix} Created new refinement pack with ID: ${newVtoPackJobId}`);

    // 4. Create a new parent batch job to group this refinement pass
    const { data: batchJob, error: batchError } = await supabase
      .from('mira-agent-batch-inpaint-jobs')
      .insert({ user_id, status: 'processing', metadata: { total_pairs: jobsToRefine.length, source_vto_pack_id: source_pack_id, refinement_vto_pack_id: newVtoPackJobId } })
      .select('id')
      .single();
    
    if (batchError) throw batchError;
    const batchJobId = batchJob.id;
    console.log(`${logPrefix} Main refinement batch job ${batchJobId} created.`);

    // 5. Create the individual pair jobs for the inpainting pipeline, linked to the NEW pack
    const pairJobsToInsert = jobsToRefine.map(job => ({
      batch_job_id: batchJobId,
      user_id: user_id,
      status: 'pending',
      source_person_image_url: job.final_image_url, // Result of pass 1 is source for pass 2
      source_garment_image_url: job.source_garment_image_url,
      prompt_appendix: job.metadata?.prompt_appendix || "",
      metadata: {
        is_helper_enabled: job.metadata?.is_helper_enabled !== false,
        pass_number: 2,
        denoise: 0.75, // Set specific denoise for refinement pass
        original_person_image_url_for_analysis: job.source_person_image_url,
        original_vto_job_id: job.id,
        vto_pack_job_id: newVtoPackJobId, // Link to the new pack
      }
    }));

    const { error: pairsError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .insert(pairJobsToInsert);

    if (pairsError) throw pairsError;
    console.log(`${logPrefix} ${pairJobsToInsert.length} refinement pair jobs created and set to 'pending'.`);

    // 6. Asynchronously invoke the watchdog to start processing immediately
    supabase.functions.invoke('MIRA-AGENT-watchdog-background-jobs').catch(console.error);

    return new Response(JSON.stringify({ success: true, message: `${pairJobsToInsert.length} refinement jobs have been queued into a new pack.` }), {
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