import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  console.log(`[BatchInpaintProxy] Received request. Method: ${req.method}`);

  if (req.method === 'OPTIONS') {
    console.log('[BatchInpaintProxy] Handling OPTIONS preflight request.');
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { pairs, user_id, skip_qa_check } = await req.json();
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0 || !user_id) {
      throw new Error("`pairs` array and `user_id` are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    console.log(`[BatchInpaintProxy] Received request with ${pairs.length} pairs for user ${user_id}. Skip QA: ${skip_qa_check}`);

    // 1. Create the main batch job entry
    const { data: batchJob, error: batchError } = await supabase
      .from('mira-agent-batch-inpaint-jobs')
      .insert({ user_id, status: 'processing', metadata: { total_pairs: pairs.length } })
      .select('id')
      .single();
    
    if (batchError) throw batchError;
    const batchJobId = batchJob.id;
    console.log(`[BatchInpaintProxy] Main batch job ${batchJobId} created.`);

    // 2. Create an entry for each pair
    const pairJobsToInsert = pairs.map(pair => ({
      batch_job_id: batchJobId,
      user_id: user_id,
      status: 'pending',
      source_person_image_url: pair.person_url,
      source_garment_image_url: pair.garment_url,
      prompt_appendix: pair.appendix,
      metadata: { 
        is_helper_enabled: pair.is_helper_enabled,
        skip_qa_check: skip_qa_check || false
      }
    }));

    const { error: pairsError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .insert(pairJobsToInsert);

    if (pairsError) throw pairsError;
    console.log(`[BatchInpaintProxy] ${pairs.length} pair jobs created and set to 'pending'.`);

    // 3. Asynchronously invoke the watchdog to start processing immediately
    supabase.functions.invoke('MIRA-AGENT-watchdog-background-jobs').catch(console.error);

    return new Response(JSON.stringify({ success: true, message: `${pairs.length} jobs have been queued for processing.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[BatchInpaintProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});