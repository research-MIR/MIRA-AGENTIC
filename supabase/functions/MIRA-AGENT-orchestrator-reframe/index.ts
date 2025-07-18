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
  if (!job_id) throw new Error("job_id is required.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[ReframeOrchestrator][${job_id}]`;

  try {
    console.log(`${logPrefix} Starting orchestration.`);
    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('context, user_id').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const { base_image_url, mask_image_url, prompt, user_id } = job.context;
    let finalPrompt = prompt;

    if (!prompt || prompt.trim() === "") {
      console.log(`${logPrefix} No user prompt provided. Generating one automatically.`);
      const { data: blob, error: downloadError } = await supabase.storage.from('mira-agent-user-uploads').download(base_image_url.split('/').slice(-2).join('/'));
      if (downloadError) throw new Error(`Failed to download base image for prompt generation: ${downloadError.message}`);
      
      const reader = new FileReader();
      const base64Promise = new Promise((resolve, reject) => {
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = reject;
      });
      reader.readAsDataURL(blob);
      const base_image_base64 = await base64Promise;

      const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-auto-describe-scene', {
        body: { base_image_base64, user_hint: "" }
      });
      if (promptError) throw new Error(`Auto-prompt generation failed: ${promptError.message}`);
      finalPrompt = promptData.scene_prompt;
      console.log(`${logPrefix} Auto-prompt generated: "${finalPrompt}"`);
    }

    console.log(`${logPrefix} Invoking final reframe tool.`);
    const { error: reframeError } = await supabase.functions.invoke('MIRA-AGENT-tool-reframe-image', {
      body: { 
        job_id,
        prompt: finalPrompt // Pass the potentially auto-generated prompt
      }
    });
    if (reframeError) throw new Error(`Reframe tool invocation failed: ${reframeError.message}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});