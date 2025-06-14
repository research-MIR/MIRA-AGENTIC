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
    
    const { data: activeJobs, error: queryError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('id')
      .in('status', ['queued', 'processing']);

    if (queryError) {
      throw new Error(`Failed to query for active jobs: ${queryError.message}`);
    }

    if (!activeJobs || activeJobs.length === 0) {
      const message = "ComfyUI Watchdog: No active jobs found.";
      console.log(message);
      return new Response(JSON.stringify({ message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    console.log(`ComfyUI Watchdog: Found ${activeJobs.length} active job(s). Invoking poller for each...`);

    const triggerPromises = activeJobs.map(job => {
      console.log(`ComfyUI Watchdog: Triggering poller for job: ${job.id}`);
      return supabase.functions.invoke('MIRA-AGENT-poller-comfyui', { body: { job_id: job.id } });
    });

    await Promise.allSettled(triggerPromises);

    const successMessage = `ComfyUI Watchdog: Successfully triggered pollers for ${activeJobs.length} job(s).`;
    return new Response(JSON.stringify({ message: successMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("ComfyUI Watchdog Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});