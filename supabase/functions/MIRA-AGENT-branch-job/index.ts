import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { source_job_id, history_index, invoker_user_id } = await req.json();
    if (!source_job_id || history_index === undefined || !invoker_user_id) {
      throw new Error("source_job_id, history_index, and invoker_user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 1. Fetch the source job to branch from
    const { data: sourceJob, error: fetchError } = await supabase
      .from('mira-agent-jobs')
      .select('*')
      .eq('id', source_job_id)
      .single();

    if (fetchError) throw fetchError;
    if (!sourceJob) throw new Error("Source job not found.");

    // 2. Slice the history to the specified branch point
    const sourceHistory = sourceJob.context?.history || [];
    // The history_index is the index of the last item to *include* in the new history.
    const newHistory = sourceHistory.slice(0, history_index + 1);

    if (newHistory.length === 0) {
        throw new Error("Cannot branch from the beginning of a conversation.");
    }

    // 3. Determine the initial state for the new branched job
    let initialResult = null;
    // If the last turn was a function response, we can use that as the initial "message" in the new chat.
    if (lastTurn.role === 'function' && lastTurn.parts[0]?.functionResponse?.response) {
        initialResult = lastTurn.parts[0].functionResponse.response;
    }

    // 4. Create the new job payload
    const newJobPayload = {
      user_id: invoker_user_id,
      original_prompt: `[Branch] ${sourceJob.original_prompt || 'Untitled'}`,
      status: 'awaiting_feedback', // Start in a paused state, ready for new user input
      context: {
        ...sourceJob.context, // Copy all settings (model, modes, etc.)
        history: newHistory,
        source: 'agent_branch', // Add a source for tracking
        parent_job_id: source_job_id,
        branch_point_index: history_index,
      },
      final_result: initialResult // Set the last message as the initial result to display
    };

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-jobs')
      .insert(newJobPayload)
      .select('id')
      .single();

    if (insertError) throw insertError;

    // 5. Return the ID of the newly created job
    return new Response(JSON.stringify({ newJobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[BranchJob] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});