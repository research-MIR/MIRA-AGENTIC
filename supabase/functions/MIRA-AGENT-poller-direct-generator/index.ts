import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

async function createGalleryEntry(supabase: any, job: any, finalResult: any) {
    const metadata = job.metadata;
    if (!metadata?.invoker_user_id || !metadata?.original_prompt_for_gallery) {
        console.log(`[DirectGenPoller][${job.id}] Skipping gallery entry creation: missing metadata.`);
        return;
    }
    const jobPayload = {
        user_id: metadata.invoker_user_id,
        original_prompt: metadata.original_prompt_for_gallery,
        status: 'complete',
        final_result: { isImageGeneration: true, images: finalResult.images },
        context: { source: 'direct_generator' }
    };
    const { error: insertError } = await supabase.from('mira-agent-jobs').insert(jobPayload);
    if (insertError) {
        console.error(`[DirectGenPoller][${job.id}] Failed to create gallery entry:`, insertError);
    } else {
        console.log(`[DirectGenPoller][${job.id}] Successfully created gallery entry.`);
    }
}

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `direct-gen-poller-${Date.now()}`;
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  if (!job_id) {
    return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });
  }

  console.log(`[DirectGenPoller][${job_id}] Invoked.`);
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    await supabase.from('mira-agent-comfyui-jobs').update({ status: 'processing', last_polled_at: new Date().toISOString() }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('metadata')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;
    const metadata = job.metadata;

    console.log(`[DirectGenPoller][${job_id}] Invoking Google image generation tool with metadata:`, metadata);
    const { data: generationResult, error: generationError } = await supabase.functions.invoke('MIRA-AGENT-tool-generate-image-google', {
      body: {
        prompt: metadata.final_prompt_used || metadata.prompt,
        negative_prompt: metadata.negative_prompt,
        number_of_images: metadata.number_of_images,
        seed: metadata.seed,
        model_id: metadata.model_id,
        invoker_user_id: metadata.invoker_user_id,
        size: metadata.size
      }
    });

    if (generationError) throw generationError;

    console.log(`[DirectGenPoller][${job_id}] Generation successful. Updating job status to 'complete'.`);
    await supabase.from('mira-agent-comfyui-jobs').update({
      status: 'complete',
      final_result: { publicUrl: generationResult.images[0]?.publicUrl }, // Store first image as representative
      error_message: null
    }).eq('id', job_id);

    await createGalleryEntry(supabase, job, generationResult);

    return new Response(JSON.stringify({ success: true, result: generationResult }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200
    });

  } catch (error) {
    console.error(`[DirectGenPoller][${job_id}] Error during processing:`, error);
    await supabase.from('mira-agent-comfyui-jobs').update({
      status: 'failed',
      error_message: error.message
    }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }
});