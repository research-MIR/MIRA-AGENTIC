import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  const requestId = `vto-submitter-${Date.now()}`;
  console.log(`[VTOSubmitter][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { 
        person_image_url, 
        garment_image_url, 
        user_id,
        sample_step,
        sample_count = 1
    } = await req.json();

    if (!person_image_url || !garment_image_url || !user_id) {
      throw new Error("person_image_url, garment_image_url, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-vto-jobs')
      .insert({
        user_id: user_id,
        person_image_url: person_image_url,
        garment_image_url: garment_image_url,
        status: 'pending',
        metadata: {
            sample_step: sample_step,
            sample_count: sample_count
        }
      })
      .select('id')
      .single();

    if (insertError) {
      console.error(`[VTOSubmitter][${requestId}] Error creating job record:`, insertError);
      throw insertError;
    }

    console.log(`[VTOSubmitter][${requestId}] Successfully created job ${newJob.id}. The database trigger will now invoke the worker.`);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 202, // 202 Accepted: The request has been accepted for processing, but the processing has not been completed.
    });

  } catch (error) {
    console.error(`[VTOSubmitter][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});