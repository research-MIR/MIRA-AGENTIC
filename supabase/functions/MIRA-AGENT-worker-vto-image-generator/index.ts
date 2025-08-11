import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

async function invokeWithRetry(supabase: SupabaseClient, functionName: string, payload: object, maxRetries: number, logPrefix: string) {
  let lastError: Error | null = null;
  for(let attempt = 1; attempt <= maxRetries; attempt++){
    try {
      const { data, error } = await supabase.functions.invoke(functionName, payload);
      if (error) {
        throw new Error(error.message || 'Function invocation failed with an unknown error.');
      }
      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`${logPrefix} Invocation of '${functionName}' failed on attempt ${attempt}/${maxRetries}. Error: ${lastError.message}`);
      if (attempt < maxRetries) {
        const delay = 15000 * attempt;
        console.warn(`${logPrefix} Waiting ${delay}ms before retrying...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError || new Error("Function failed after all retries without a specific error.");
}

serve(async (req) => {
  const { task_id } = await req.json();
  if (!task_id) {
    return new Response(JSON.stringify({ error: "task_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-Image-Generator][Task ${task_id}]`;

  try {
    console.log(`${logPrefix} Starting task.`);
    await supabase.from('mira-agent-vto-generation-tasks').update({ status: 'processing' }).eq('id', task_id);

    const { data: task, error: fetchTaskError } = await supabase
      .from('mira-agent-vto-generation-tasks')
      .select('*, vto_job:mira-agent-bitstudio-jobs(*)')
      .eq('id', task_id)
      .single();

    if (fetchTaskError) throw fetchTaskError;
    if (!task || !task.vto_job) throw new Error("Task or parent VTO job not found.");

    const { vto_job, sample_step } = task;
    const { metadata } = vto_job;

    const generatedImages = await invokeWithRetry(supabase, 'MIRA-AGENT-tool-virtual-try-on', {
      body: {
        person_image_url: metadata.cropped_person_url,
        garment_image_url: metadata.optimized_garment_url,
        sample_count: 2, // Always generate 2 images per task
        sample_step: sample_step
      }
    }, 3, logPrefix);

    await supabase.from('mira-agent-vto-generation-tasks').update({
      status: 'complete',
      result_data: { images: generatedImages.generatedImages }
    }).eq('id', task_id);

    console.log(`${logPrefix} Task complete. Saved ${generatedImages.generatedImages.length} images.`);
    
    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-vto-generation-tasks').update({
      status: 'failed',
      error_message: error.message
    }).eq('id', task_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});