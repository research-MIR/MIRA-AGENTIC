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
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const cancellationReason = "Cancelled by admin dev tool.";

    const { count, error } = await supabase
      .from('mira-agent-jobs')
      .update({ status: 'failed', error_message: cancellationReason })
      .in('status', ['processing', 'queued'])
      .eq('context->>source', 'direct_generator')
      .eq('context->>model_id', 'fal-ai/wan/v2.2-a14b/text-to-image');

    if (error) {
      throw new Error(`Failed to cancel Wan jobs: ${error.message}`);
    }
    
    const message = `Successfully cancelled ${count || 0} active Wan generator job(s).`;
    console.log(message);

    return new Response(JSON.stringify({ success: true, message, count }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[AdminCancelWanJobs] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});