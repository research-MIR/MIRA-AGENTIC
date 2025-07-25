import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CHUNK_SIZE = 40;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  
  const { pack_id, user_id } = await req.json();
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-Report-Chunker][${pack_id}]`;

  try {
    if (!pack_id || !user_id) {
      throw new Error("pack_id and user_id are required.");
    }
    console.log(`${logPrefix} Worker started.`);

    const { data: reports, error: rpcError } = await supabase.rpc('get_vto_report_details_for_pack', {
      p_pack_id: pack_id,
      p_user_id_override: user_id
    });

    if (rpcError) throw new Error(`Failed to fetch report details: ${rpcError.message}`);
    if (!reports || reports.length === 0) {
      throw new Error("No analysis reports found for this pack to synthesize.");
    }

    const comparativeReports = reports.map((r: any) => r.comparative_report).filter(Boolean);
    if (comparativeReports.length === 0) {
        throw new Error("No valid comparative reports found in the fetched data.");
    }

    console.log(`${logPrefix} Found ${comparativeReports.length} reports. Creating chunk jobs in database...`);

    const chunks = [];
    for (let i = 0; i < comparativeReports.length; i += CHUNK_SIZE) {
        chunks.push(comparativeReports.slice(i, i + CHUNK_SIZE));
    }

    const chunkJobsToInsert = chunks.map(chunk => ({
        pack_id: pack_id,
        chunk_data: chunk,
        status: 'pending'
    }));

    const { error: insertError } = await supabase
        .from('mira-agent-vto-report-chunks')
        .insert(chunkJobsToInsert);

    if (insertError) throw insertError;

    console.log(`${logPrefix} Successfully created ${chunkJobsToInsert.length} chunk jobs. The watchdog will now pick them up.`);

    return new Response(JSON.stringify({ success: true, message: `Created ${chunkJobsToInsert.length} analysis chunks.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-vto-packs-jobs').update({
        synthesis_report: `# Analysis Failed\n\nAn error occurred during the chunking process: ${error.message}`
    }).eq('id', pack_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});