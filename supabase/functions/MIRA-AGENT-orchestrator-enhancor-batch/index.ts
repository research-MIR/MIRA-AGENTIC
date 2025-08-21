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
    const { user_id, source_image_urls } = await req.json();
    if (!user_id || !source_image_urls || !Array.isArray(source_image_urls) || source_image_urls.length === 0) {
      throw new Error("user_id and a non-empty source_image_urls array are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: batchJob, error: insertError } = await supabase
      .from('enhancor_ai_batch_jobs')
      .insert({
        user_id,
        total_images: source_image_urls.length,
        status: 'processing',
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    const batchJobId = batchJob.id;

    const jobPromises = source_image_urls.flatMap(url => [
      supabase.functions.invoke('MIRA-AGENT-proxy-enhancor-ai', {
        body: { user_id, source_image_urls: [url], enhancor_mode: 'general', batch_job_id: batchJobId }
      }),
      supabase.functions.invoke('MIRA-AGENT-proxy-enhancor-ai', {
        body: { user_id, source_image_urls: [url], enhancor_mode: 'detailed', batch_job_id: batchJobId }
      })
    ]);

    // Don't await these, let them run in the background
    Promise.allSettled(jobPromises).then(results => {
      const failedCount = results.filter(r => r.status === 'rejected').length;
      if (failedCount > 0) {
        console.error(`[EnhancorBatchOrchestrator] Failed to invoke proxy for ${failedCount} jobs.`);
      }
    });

    return new Response(JSON.stringify({ success: true, batchJobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EnhancorBatchOrchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});