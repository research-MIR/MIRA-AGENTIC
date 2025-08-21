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
    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    if (!jobId) {
      throw new Error("Webhook received without a job_id in the query parameters.");
    }

    const payload = await req.json();
    const { request_id, result, status } = payload;

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    if (status === 'success' && result) {
      await supabase
        .from('enhancor_ai_jobs')
        .update({
          status: 'complete',
          final_image_url: result,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    } else {
      await supabase
        .from('enhancor_ai_jobs')
        .update({
          status: 'failed',
          error_message: `EnhancorAI reported failure. Status: ${status}. Full payload: ${JSON.stringify(payload)}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EnhancorAIWebhook] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});