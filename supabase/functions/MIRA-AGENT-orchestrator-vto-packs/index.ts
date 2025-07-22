import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHUNK_SIZE = 25; // Insert jobs in chunks of 25 to avoid hitting data limits

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

    const allPairJobsToInsert = pairs.map((pair: any) => ({
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

    let totalInserted = 0;
    for (let i = 0; i < allPairJobsToInsert.length; i += CHUNK_SIZE) {
        const chunk = allPairJobsToInsert.slice(i, i + CHUNK_SIZE);
        console.log(`[VTO-Packs-Orchestrator] Inserting chunk ${i / CHUNK_SIZE + 1} with ${chunk.length} jobs...`);
        const { data: insertedJobs, error: insertError } = await supabase
            .from('mira-agent-bitstudio-jobs')
            .insert(chunk)
            .select('id');

        if (insertError) {
            console.error(`[VTO-Packs-Orchestrator] Error inserting chunk:`, insertError);
            throw new Error(`Failed to insert a chunk of jobs: ${insertError.message}`);
        }
        
        if (insertedJobs) {
            totalInserted += insertedJobs.length;
        }
    }

    if (totalInserted !== pairs.length) {
        throw new Error(`Mismatch in job creation. Expected ${pairs.length}, but only created ${totalInserted}.`);
    }

    console.log(`[VTO-Packs-Orchestrator] Successfully inserted all ${totalInserted} pair jobs with 'pending' status. The watchdog will start processing them shortly.`);

    return new Response(JSON.stringify({ success: true, message: `${totalInserted} jobs have been queued for processing.` }), {
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