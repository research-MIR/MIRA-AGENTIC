import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const FAL_WEBHOOK_SECRET = Deno.env.get("FAL_WEBHOOK_SECRET");

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[ReframeWebhook-Fal]`;

  try {
    if (req.headers.get("x-webhook-secret") !== FAL_WEBHOOK_SECRET) {
        console.error(`${logPrefix} Invalid or missing webhook secret received.`);
        return new Response("Forbidden", { status: 403 });
    }

    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    if (!jobId) throw new Error("Webhook received without a job_id.");

    const payload = await req.json();
    const { status, payload: resultPayload, error: falError } = payload;

    const { data: reframeJob, error: fetchError } = await supabase
      .from('fal_reframe_jobs')
      .select('parent_vto_job_id, user_id')
      .eq('id', jobId)
      .single();
    
    if (fetchError) throw new Error(`Could not find tracking job ${jobId}: ${fetchError.message}`);
    const { parent_vto_job_id, user_id } = reframeJob;

    if (status === 'OK' && resultPayload) {
      console.log(`${logPrefix} Job ${jobId} completed successfully.`);
      const imageUrl = Object.values(resultPayload.outputs)
        .flatMap((node: any) => (node?.images || []).map((img: any) => img.url))
        .find(Boolean);

      if (!imageUrl) throw new Error("No image URL found in webhook payload.");

      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) throw new Error(`Failed to download final image from Fal.ai: ${imageResponse.statusText}`);
      const imageBuffer = await imageResponse.arrayBuffer();

      const filePath = `${user_id}/reframe-results/${Date.now()}_final.png`;
      await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
      const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

      const finalResult = { publicUrl, storagePath: filePath };
      await supabase.from('fal_reframe_jobs').update({ status: 'complete', final_result: finalResult }).eq('id', jobId);
      
      if (parent_vto_job_id) {
        await supabase.from('mira-agent-bitstudio-jobs').update({
          status: 'complete',
          final_image_url: publicUrl,
          metadata: { google_vto_step: 'done' } // Ensure we mark the step as done
        }).eq('id', parent_vto_job_id);
      }
      console.log(`${logPrefix} Job ${jobId} and parent VTO job ${parent_vto_job_id} finalized.`);

    } else {
      const errorMessage = `Fal.ai reported failure for job ${jobId}. Details: ${JSON.stringify({ status, falError })}`;
      console.error(`${logPrefix} ${errorMessage}`);
      await supabase.from('fal_reframe_jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', jobId);
      if (parent_vto_job_id) {
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Delegated reframe job failed: ${errorMessage}` }).eq('id', parent_vto_job_id);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});