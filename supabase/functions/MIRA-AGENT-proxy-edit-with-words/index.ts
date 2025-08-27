import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { source_image_url, instruction, reference_image_urls, invoker_user_id } = await req.json();
    if (!source_image_url || !instruction || !invoker_user_id) {
      throw new Error("source_image_url, instruction, and invoker_user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .insert({
        user_id: invoker_user_id,
        status: 'queued',
        metadata: {
          source: 'edit-with-words',
          source_image_url,
          instruction,
          reference_image_urls,
        }
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // Asynchronously invoke the worker
    supabase.functions.invoke('MIRA-AGENT-worker-edit-with-words', {
      body: { job_id: newJob.id }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EditWithWordsProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});