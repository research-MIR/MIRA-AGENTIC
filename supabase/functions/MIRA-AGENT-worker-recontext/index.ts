import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function uploadBase64ToStorage(supabase: SupabaseClient, base64: string, userId: string, filename: string) {
    const { decodeBase64 } = await import("https://deno.land/std@0.224.0/encoding/base64.ts");
    const buffer = decodeBase64(base64);
    const filePath = `${userId}/recontext-results/${Date.now()}-${filename}`;
    const { error } = await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return { publicUrl, storagePath: filePath };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[RecontextWorker][${job_id}]`;

  try {
    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('*').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const { context, user_id } = job;
    const step = context.recontext_step || 'start';
    console.log(`${logPrefix} Current step: ${step}`);

    switch (step) {
      case 'start': {
        console.log(`${logPrefix} Calling prompt helper...`);
        const { data: promptData, error: helperError } = await supabase.functions.invoke('MIRA-AGENT-tool-recontext-prompt-helper', {
          body: { 
            product_images_base64: context.product_images_base64, 
            user_scene_prompt: context.user_scene_prompt,
            scene_reference_image_base64: context.scene_reference_image_base64
          }
        });
        if (helperError) throw helperError;

        console.log(`${logPrefix} Calling recontext tool...`);
        const { data: imageData, error: generationError } = await supabase.functions.invoke('MIRA-AGENT-tool-product-recontext', {
          body: {
            product_images_base64: context.product_images_base64,
            prompt: promptData.final_prompt,
            product_description: promptData.product_description
          }
        });
        if (generationError) throw generationError;

        await supabase.from('mira-agent-jobs').update({
          context: {
            ...context,
            recontext_step: 'recontext_done',
            generated_1_1_image_base64: imageData.base64Image,
            final_prompt_used: promptData.final_prompt,
          }
        }).eq('id', job_id);

        console.log(`${logPrefix} Recontext 1:1 image generated. Re-invoking worker for next step.`);
        supabase.functions.invoke('MIRA-AGENT-worker-recontext', { body: { job_id } }).catch(console.error);
        break;
      }

      case 'recontext_done': {
        if (context.aspect_ratio === '1:1') {
          console.log(`${logPrefix} Aspect ratio is 1:1. Finalizing job.`);
          const finalImage = await uploadBase64ToStorage(supabase, context.generated_1_1_image_base64, user_id, 'final.png');
          await supabase.from('mira-agent-jobs').update({
            status: 'complete',
            final_result: { images: [finalImage] },
            context: { ...context, generated_1_1_image_base64: null } // Clear large data
          }).eq('id', job_id);
        } else {
          console.log(`${logPrefix} Aspect ratio is ${context.aspect_ratio}. Dispatching to reframe tool.`);
          const { data: reframeJob, error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-reframe', {
            body: {
              user_id: user_id,
              base_image_base64: context.generated_1_1_image_base64,
              prompt: context.final_prompt_used,
              aspect_ratio: context.aspect_ratio,
              source: 'reframe_from_recontext',
              parent_recontext_job_id: job_id
            }
          });
          if (proxyError) throw proxyError;

          await supabase.from('mira-agent-jobs').update({
            status: 'awaiting_reframe',
            context: { ...context, delegated_reframe_job_id: reframeJob.jobId, generated_1_1_image_base64: null }
          }).eq('id', job_id);
          console.log(`${logPrefix} Reframe job ${reframeJob.jobId} created. Worker is now paused.`);
        }
        break;
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});