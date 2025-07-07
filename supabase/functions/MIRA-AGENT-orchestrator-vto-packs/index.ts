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
    const { pairs, user_id } = await req.json();
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0 || !user_id) {
      throw new Error("`pairs` array and `user_id` are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    console.log(`[VTO-Packs-Orchestrator] Received request with ${pairs.length} pairs for user ${user_id}.`);

    // 1. Create the main batch job entry
    const { data: batchJob, error: batchError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .insert({ user_id, metadata: { total_pairs: pairs.length } })
      .select('id')
      .single();
    
    if (batchError) throw batchError;
    const vtoPackJobId = batchJob.id;
    console.log(`[VTO-Packs-Orchestrator] Main batch job ${vtoPackJobId} created.`);

    // 2. Asynchronously invoke the proxy for each pair, passing the new batch ID
    const jobPromises = pairs.map(async (pair: any) => {
      try {
        const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
            body: { 
                person_image_url: pair.person_url, 
                garment_image_url: pair.garment_url, 
                user_id: user_id, 
                mode: 'base',
                prompt_appendix: pair.appendix,
                vto_pack_job_id: vtoPackJobId // Pass the parent batch ID
            }
        });
        if (error) throw error;
      } catch (err) {
        console.error(`[VTO-Packs-Orchestrator] Failed to queue job for person ${pair.person_url}:`, err);
      }
    });

    // We don't await the promises here, we just fire them off.
    Promise.allSettled(jobPromises);

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