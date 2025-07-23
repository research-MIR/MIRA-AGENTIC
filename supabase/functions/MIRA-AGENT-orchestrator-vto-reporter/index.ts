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
    const logPrefix = `[VTO-QA-Orchestrator][${pack_id}]`;
    console.log(`${logPrefix} Starting analysis orchestration.`);

    // 1. Fetch all completed child jobs for the pack
    const { data: completedJobs, error: fetchJobsError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id')
      .eq('vto_pack_job_id', pack_id)
      .eq('status', 'complete')
      .not('final_image_url', 'is', null);

    if (fetchJobsError) throw new Error(`Failed to fetch child jobs: ${fetchJobsError.message}`);
    if (!completedJobs || completedJobs.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No completed jobs found in this pack to analyze." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    console.log(`${logPrefix} Found ${completedJobs.length} completed jobs in the pack.`);

    // 2. Fetch all existing QA reports for this pack to avoid duplicates
    const { data: existingReports, error: fetchReportsError } = await supabase
      .from('mira-agent-vto-qa-reports')
      .select('source_vto_job_id')
      .eq('vto_pack_job_id', pack_id);
    
    if (fetchReportsError) throw new Error(`Failed to check for existing reports: ${fetchReportsError.message}`);
    
    const analyzedJobIds = new Set(existingReports.map(r => r.source_vto_job_id));
    console.log(`${logPrefix} Found ${analyzedJobIds.size} existing analysis reports.`);

    // 3. Filter out jobs that have already been analyzed
    const jobsToAnalyze = completedJobs.filter(job => !analyzedJobIds.has(job.id));

    if (jobsToAnalyze.length === 0) {
      console.log(`${logPrefix} All completed jobs have already been analyzed.`);
      return new Response(JSON.stringify({ success: true, message: "Analysis is already up-to-date for this pack." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    console.log(`${logPrefix} Queuing ${jobsToAnalyze.length} new jobs for analysis.`);

    // 4. Create new QA job entries for the remaining jobs
    const newQaJobs = jobsToAnalyze.map(job => ({
      user_id,
      vto_pack_job_id: pack_id,
      source_vto_job_id: job.id,
      status: 'pending',
    }));

    const { error: insertError } = await supabase
      .from('mira-agent-vto-qa-reports')
      .insert(newQaJobs);

    if (insertError) throw new Error(`Failed to create QA jobs: ${insertError.message}`);

    // 5. Asynchronously invoke the watchdog to start processing immediately
    supabase.functions.invoke('MIRA-AGENT-watchdog-background-jobs').catch(console.error);

    const message = `Successfully queued ${jobsToAnalyze.length} jobs for analysis.`;
    console.log(`${logPrefix} ${message}`);
    return new Response(JSON.stringify({ success: true, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-QA-Orchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});