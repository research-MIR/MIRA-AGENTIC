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
    const { pack_id, user_id } = await req.json();
    if (!pack_id || !user_id) {
      throw new Error("pack_id and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[ResetVtoAnalysis][${pack_id}]`;
    console.log(`${logPrefix} Attempting to delete reports for user ${user_id}.`);

    const { count, error } = await supabase
      .from('mira-agent-vto-qa-reports')
      .delete()
      .eq('vto_pack_job_id', pack_id)
      .eq('user_id', user_id);

    if (error) {
      console.error(`${logPrefix} Error deleting reports:`, error);
      throw error;
    }

    const message = `Successfully deleted ${count || 0} existing QA reports for pack ${pack_id}.`;
    console.log(`${logPrefix} ${message}`);

    return new Response(JSON.stringify({ success: true, message, deleted_count: count }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ResetVtoAnalysis] Unhandled error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});