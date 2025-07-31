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
    const { pack_id, scope, user_id } = await req.json();
    if (!pack_id || !scope || !user_id) {
      throw new Error("pack_id, scope, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    let imageUrls: string[] = [];

    if (scope === 'passed_only') {
      const { data: reports, error: reportsError } = await supabase
        .from('mira-agent-vto-qa-reports')
        .select('source_vto_job_id')
        .eq('vto_pack_job_id', pack_id)
        .eq('user_id', user_id)
        .eq('comparative_report->>overall_pass', 'true');
      
      if (reportsError) throw reportsError;
      if (!reports || reports.length === 0) {
        return new Response(JSON.stringify({ urls: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const jobIds = reports.map(r => r.source_vto_job_id);
      const { data: jobs, error: jobsError } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('final_image_url')
        .in('id', jobIds)
        .not('final_image_url', 'is', null);
      
      if (jobsError) throw jobsError;
      imageUrls = jobs.map(j => j.final_image_url!);

    } else { // 'all_completed'
      const { data: jobs, error: jobsError } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('final_image_url')
        .eq('vto_pack_job_id', pack_id)
        .eq('user_id', user_id)
        .in('status', ['complete', 'done'])
        .not('final_image_url', 'is', null);
      
      if (jobsError) throw jobsError;
      imageUrls = jobs.map(j => j.final_image_url!);
    }

    return new Response(JSON.stringify({ urls: imageUrls }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[GetPackImageUrls] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});