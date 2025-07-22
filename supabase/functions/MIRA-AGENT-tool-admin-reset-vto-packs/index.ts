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
    const incompleteStatuses = ['queued', 'processing', 'compositing', 'delegated', 'pending', 'segmenting', 'awaiting_fix', 'fixing'];

    // 1. Find all pack IDs that have at least one incomplete job
    const { data: incompletePacks, error: packIdError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('vto_pack_job_id')
      .in('status', incompleteStatuses)
      .not('vto_pack_job_id', 'is', null);

    if (packIdError) throw packIdError;

    if (!incompletePacks || incompletePacks.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No incomplete VTO packs found to reset." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const packIdsToDelete = [...new Set(incompletePacks.map(p => p.vto_pack_job_id).filter(Boolean))];
    if (packIdsToDelete.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No incomplete VTO packs found to reset." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }
    console.log(`Found ${packIdsToDelete.length} incomplete packs to delete.`);

    // 2. Delete all child jobs associated with these packs
    const { count: deletedChildrenCount, error: deleteChildrenError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .delete()
      .in('vto_pack_job_id', packIdsToDelete);

    if (deleteChildrenError) throw deleteChildrenError;

    // 3. Delete the parent pack jobs
    const { count: deletedPacksCount, error: deletePacksError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .delete()
      .in('id', packIdsToDelete);

    if (deletePacksError) throw deletePacksError;

    const message = `Successfully deleted ${deletedPacksCount || 0} incomplete VTO packs and their ${deletedChildrenCount || 0} associated jobs.`;
    console.log(message);

    return new Response(JSON.stringify({ success: true, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[AdminResetVtoPacks] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});