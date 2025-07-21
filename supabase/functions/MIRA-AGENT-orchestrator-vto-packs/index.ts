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
    const { pairs, user_id, engine = 'google', aspect_ratio, skip_reframe = false } = await req.json();
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0 || !user_id) {
      throw new Error("`pairs` array and `user_id` are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    console.log(`[VTO-Packs-Orchestrator] Received request for ${pairs.length} pairs for user ${user_id} using engine: ${engine}. Aspect Ratio: ${aspect_ratio}. Skip Reframe: ${skip_reframe}`);

    const { data: batchJob, error: batchError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .insert({ user_id, metadata: { total_pairs: pairs.length, engine: engine, aspect_ratio: aspect_ratio, skip_reframe: skip_reframe } })
      .select('id')
      .single();
    
    if (batchError) throw batchError;
    const vtoPackJobId = batchJob.id;
    console.log(`[VTO-Packs-Orchestrator] Main batch job ${vtoPackJobId} created.`);

    const pairJobsToInsert = pairs.map((pair: any) => ({
        user_id,
        vto_pack_job_id: vtoPackJobId,
        mode: 'base',
        status: 'pending', // All jobs start as pending
        source_person_image_url: pair.person_url,
        source_garment_image_url: pair.garment_url,
        metadata: { 
            engine: engine,
            prompt_appendix: pair.appendix,
            final_aspect_ratio: aspect_ratio,
            skip_reframe: skip_reframe,
        }
    }));

    const { data: insertedJobs, error: insertError } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .insert(pairJobsToInsert)
        .select('id')
        .order('created_at', { ascending: true });

    if (insertError) throw insertError;
    if (!insertedJobs || insertedJobs.length === 0) {
        throw new Error("Failed to insert pair jobs into the database.");
    }

    console.log(`[VTO-Packs-Orchestrator] ${insertedJobs.length} pair jobs created with 'pending' status.`);

    // Kick off the first job in the sequence
    const firstJobId = insertedJobs[0].id;
    console.log(`[VTO-Packs-Orchestrator] Kicking off the first job in the sequence: ${firstJobId}`);
    
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'queued' }).eq('id', firstJobId);

    supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
        body: { pair_job_id: firstJobId }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, message: `${pairs.length} jobs have been queued for processing.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-Packs-Orchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});