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
    const { user_id, image_url, enhancor_mode, enhancor_params } = await req.json();
    if (!user_id || !image_url || !enhancor_mode) {
      throw new Error("user_id, image_url, and enhancor_mode are required.");
    }

    const validModes = ['portrait', 'general', 'detailed'];
    if (!validModes.includes(enhancor_mode)) {
        throw new Error(`Invalid enhancor_mode. Must be one of: ${validModes.join(', ')}`);
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: newJob, error: insertError } = await supabase
      .from('enhancor_ai_jobs')
      .insert({
        user_id,
        source_image_url: image_url,
        enhancor_mode,
        enhancor_params,
        status: 'queued'
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // Asynchronously invoke the poller to start processing immediately.
    supabase.functions.invoke('MIRA-AGENT-poller-EnhancorAI').catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EnhancorAI-Proxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});