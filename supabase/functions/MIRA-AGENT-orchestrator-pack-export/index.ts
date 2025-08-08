import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { pack_id, user_id, export_structure } = await req.json();
    if (!pack_id || !user_id || !export_structure) {
      throw new Error("pack_id, user_id, and export_structure are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[PackExportOrchestrator][${pack_id}]`;
    console.log(`${logPrefix} Creating export job record.`);

    // Create a new job in the export table. This is the function's only job now.
    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-export-jobs')
      .insert({
        user_id,
        pack_id,
        export_structure,
        status: 'pending' // The client will update this as it works
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    console.log(`${logPrefix} Export job ${newJob.id} created. Returning to client for processing.`);
    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error)
  {
    console.error("[PackExportOrchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});