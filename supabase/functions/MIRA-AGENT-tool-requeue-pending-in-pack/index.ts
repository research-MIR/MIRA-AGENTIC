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
    const logPrefix = `[RequeuePending][${pack_id}]`;
    console.log(`${logPrefix} Function invoked by user ${user_id}.`);

    // Security check
    const { data: packOwner, error: ownerError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .select('user_id')
      .eq('id', pack_id)
      .single();
    if (ownerError) throw new Error(`Could not verify pack ownership: ${ownerError.message}`);
    if (packOwner.user_id !== user_id) throw new Error("Permission denied.");

    let totalRequeued = 0;

    // --- Handle Standard VTO Jobs ---
    const { data: pendingBitstudioJobs, error: bitstudioError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id')
      .eq('vto_pack_job_id', pack_id)
      .eq('status', 'pending');
    if (bitstudioError) throw bitstudioError;

    if (pendingBitstudioJobs && pendingBitstudioJobs.length > 0) {
      console.log(`${logPrefix} Found ${pendingBitstudioJobs.length} pending standard VTO jobs to re-queue.`);
      const workerPromises = pendingBitstudioJobs.map(job =>
        supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: job.id } })
      );
      await Promise.allSettled(workerPromises);
      totalRequeued += pendingBitstudioJobs.length;
    }

    // --- Handle Refinement Pass Jobs ---
    const { data: pendingPairJobs, error: pairError } = await supabase
      .from('mira-agent-batch-inpaint-pair-jobs')
      .select('id')
      .eq('metadata->>vto_pack_job_id', pack_id)
      .eq('status', 'pending');
    if (pairError) throw pairError;

    if (pendingPairJobs && pendingPairJobs.length > 0) {
      console.log(`${logPrefix} Found ${pendingPairJobs.length} pending refinement jobs to re-queue.`);
      const workerPromises = pendingPairJobs.map(job =>
        supabase.functions.invoke('MIRA-AGENT-worker-batch-inpaint', { body: { pair_job_id: job.id } })
      );
      await Promise.allSettled(workerPromises);
      totalRequeued += pendingPairJobs.length;
    }

    const message = `Successfully re-queued ${totalRequeued} pending job(s).`;
    console.log(`${logPrefix} ${message}`);
    return new Response(JSON.stringify({ success: true, message, count: totalRequeued }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[RequeuePending] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});