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
    const { pairs, user_id, engine = 'bitstudio', aspect_ratio } = await req.json();
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0 || !user_id) {
      throw new Error("`pairs` array and `user_id` are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    console.log(`[VTO-Packs-Orchestrator] Received request for ${pairs.length} pairs for user ${user_id} using engine: ${engine}. Aspect Ratio: ${aspect_ratio}`);

    const { data: batchJob, error: batchError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .insert({ user_id, metadata: { total_pairs: pairs.length, engine: engine, aspect_ratio: aspect_ratio } })
      .select('id')
      .single();
    
    if (batchError) throw batchError;
    const vtoPackJobId = batchJob.id;
    console.log(`[VTO-Packs-Orchestrator] Main batch job ${vtoPackJobId} created.`);

    const jobPromises = pairs.map(async (pair: any, index: number) => {
      const pairLogPrefix = `[VTO-Packs-Orchestrator][Pair ${index + 1}/${pairs.length}]`;
      try {
        console.log(`${pairLogPrefix} Processing pair. Person: ${pair.person_url}, Garment: ${pair.garment_url}`);
        
        const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
            user_id,
            vto_pack_job_id: vtoPackJobId,
            mode: 'base',
            status: 'queued',
            source_person_image_url: pair.person_url,
            source_garment_image_url: pair.garment_url,
            metadata: { 
                engine: engine,
                prompt_appendix: pair.appendix,
                final_aspect_ratio: aspect_ratio, // Store aspect ratio for the worker
            }
        }).select('id').single();

        if (insertError) throw insertError;
        const newJobId = newJob.id;
        console.log(`${pairLogPrefix} Job record created with ID: ${newJobId}`);

        if (engine === 'google') {
          console.log(`${pairLogPrefix} Using Google VTO engine. Invoking pack worker...`);
          supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
            body: { pair_job_id: newJobId }
          }).catch(console.error);
        } else { // Default to bitstudio
          console.log(`${pairLogPrefix} Using BitStudio engine. Invoking proxy...`);
          const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
              body: { 
                  person_image_url: pair.person_url, 
                  garment_image_url: pair.garment_url, 
                  user_id: user_id, 
                  mode: 'base',
                  prompt_appendix: pair.appendix,
                  vto_pack_job_id: vtoPackJobId,
                  existing_job_id: newJobId 
              }
          });
          if (error) throw error;
          console.log(`${pairLogPrefix} BitStudio proxy invoked successfully.`);
        }
      } catch (err) {
        console.error(`${pairLogPrefix} Failed to queue job for person ${pair.person_url}:`, err);
      }
    });

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