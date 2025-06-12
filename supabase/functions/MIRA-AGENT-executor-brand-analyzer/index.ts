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
  const { job_id } = await req.json();
  if (!job_id) { throw new Error("Missing 'job_id'"); }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('*').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const context = job.context || {};
    const brandAnalyzerState = context.brand_analyzer_state || { step: 'start' };
    const brandName = context.brand_name || job.original_prompt.replace('analyze brand', '').trim();
    
    if (!brandName) {
        throw new Error("Could not determine brand name from job context or original prompt.");
    }

    console.log(`[BrandAnalyzer][${job_id}] Current step: ${brandAnalyzerState.step} for brand: ${brandName}`);

    let nextState = { ...brandAnalyzerState };
    let nextWorkerToInvoke: string | null = null;

    switch (brandAnalyzerState.step) {
      case 'start': {
        const { data } = await supabase.functions.invoke('MIRA-AGENT-tool-google-search', { body: { query: `${brandName} official website` } });
        nextState = { step: 'website_found', website_url: data.results[0]?.url };
        break;
      }
      case 'website_found': {
        const { data } = await supabase.functions.invoke('MIRA-AGENT-tool-analyze-url-content', { body: { url: brandAnalyzerState.website_url } });
        nextState = { ...brandAnalyzerState, step: 'website_analyzed', website_analysis: data };
        break;
      }
      case 'website_analyzed': {
        const { data } = await supabase.functions.invoke('MIRA-AGENT-tool-google-search', { body: { query: `${brandName} instagram` } });
        nextState = { ...brandAnalyzerState, step: 'social_media_found', social_media_url: data.results[0]?.url };
        break;
      }
      case 'social_media_found': {
        const { data } = await supabase.functions.invoke('MIRA-AGENT-tool-analyze-url-content', { body: { url: brandAnalyzerState.social_media_url } });
        nextState = { ...brandAnalyzerState, step: 'complete', social_media_analysis: data };
        break;
      }
      case 'complete': {
        console.log(`[BrandAnalyzer][${job_id}] Sub-plan complete. Reporting back to Master Worker.`);
        const finalReport = {
            brand_name: brandName,
            website_analysis: {
                url: brandAnalyzerState.website_url,
                analysis: brandAnalyzerState.website_analysis
            },
            social_media_analysis: {
                url: brandAnalyzerState.social_media_url,
                analysis: brandAnalyzerState.social_media_analysis
            },
            // In a real scenario, a final synthesis would be generated here by another LLM call
            combined_synthesis: `This is a combined analysis for ${brandName}.`
        };

        const newHistory = [
            ...context.history,
            { role: 'function', parts: [{ functionResponse: { name: 'dispatch_to_brand_analyzer', response: finalReport } }] }
        ];

        await supabase.from('mira-agent-jobs').update({ status: 'processing', context: { ...context, history: newHistory, brand_analyzer_state: undefined, brand_analysis_report: finalReport } }).eq('id', job_id);
        nextWorkerToInvoke = 'MIRA-AGENT-master-worker';
        break;
      }
    }

    if (brandAnalyzerState.step !== 'complete') {
        console.log(`[BrandAnalyzer][${job_id}] Saving state and advancing to step: ${nextState.step}`);
        await supabase.from('mira-agent-jobs').update({ context: { ...context, brand_analyzer_state: nextState } }).eq('id', job_id);
        nextWorkerToInvoke = 'MIRA-AGENT-executor-brand-analyzer';
    }
    
    if (nextWorkerToInvoke) {
        console.log(`[BrandAnalyzer][${job_id}] Invoking next worker: ${nextWorkerToInvoke}`);
        supabase.functions.invoke(nextWorkerToInvoke, { body: { job_id } }).catch(console.error);
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[BrandAnalyzer][${job_id}] Error:`, error);
    await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: `Brand Analyzer failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});