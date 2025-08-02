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
    const { pack_id, user_id, scope = 'successful_only' } = await req.json();
    if (!pack_id || !user_id) {
      throw new Error("pack_id and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[VTO-Refinement-Orchestrator][${pack_id}]`;
    console.log(`${logPrefix} Starting refinement pass for user ${user_id} with scope: ${scope}.`);

    // Step 1: Call the new, powerful database function to do all the heavy lifting.
    const { data: newPackId, error: rpcError } = await supabase.rpc('MIRA-AGENT-create-refinement-pass', {
        p_source_pack_id: pack_id,
        p_user_id: user_id,
        p_scope: scope
    });

    if (rpcError) {
        console.error(`${logPrefix} RPC failed:`, rpcError);
        throw new Error(`Database operation failed: ${rpcError.message}`);
    }

    if (!newPackId) {
        const message = "No jobs found for the selected scope to refine. No new pack was created.";
        console.log(`${logPrefix} ${message}`);
        return new Response(JSON.stringify({ success: true, message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    console.log(`${logPrefix} Database function completed successfully. New refinement pack ID: ${newPackId}.`);

    // Step 2: Asynchronously invoke the watchdog to start processing the new jobs immediately.
    supabase.functions.invoke('MIRA-AGENT-watchdog-background-jobs').catch(console.error);

    const message = `Successfully created a new refinement pass. The jobs have been queued for processing.`;
    console.log(`${logPrefix} ${message}`);
    return new Response(JSON.stringify({ success: true, message, newPackId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-Refinement-Orchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});