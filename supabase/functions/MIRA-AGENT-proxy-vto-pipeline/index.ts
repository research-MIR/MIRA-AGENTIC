import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { person_image_url, garment_image_url, user_id, mode } = await req.json();
    if (!person_image_url || !garment_image_url || !user_id) {
      throw new Error("person_image_url, garment_image_url, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-vto-pipeline-jobs')
      .insert({
        user_id,
        source_person_image_url: person_image_url,
        source_garment_image_url: garment_image_url,
        status: 'pending_segmentation',
        context: {
          mode: mode || 'edit' // Default to 'edit' if not provided
        }
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // Asynchronously invoke the worker to start the pipeline
    supabase.functions.invoke('MIRA-AGENT-worker-vto-pipeline', {
      body: { job_id: newJob.id }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO Pipeline Proxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});