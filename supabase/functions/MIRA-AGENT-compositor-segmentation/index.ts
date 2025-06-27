import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export default async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  const requestId = `compositor-smoketest-${job_id}`;
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  console.log(`[Compositor-SmokeTest][${requestId}] Function invoked successfully.`);

  try {
    // In this test, we'll just mark the job as failed with a specific message
    // to prevent it from being picked up by the watchdog again.
    const errorMessage = "SMOKE TEST: Function is invoking correctly, but canvas logic is disabled. The 'deno-canvas' library is the issue.";
    console.log(`[Compositor-SmokeTest][${requestId}] ${errorMessage}`);

    await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .update({ status: 'failed', error_message: errorMessage })
      .eq('id', job_id);

    return new Response(JSON.stringify({ success: true, message: "Smoke test successful. Canvas logic is the problem." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Compositor-SmokeTest][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
};