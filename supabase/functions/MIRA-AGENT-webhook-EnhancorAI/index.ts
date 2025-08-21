import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function finalizeJob(supabase: SupabaseClient, requestId: string, resultUrl: string) {
    const { data: job, error: fetchError } = await supabase
        .from('enhancor_ai_jobs')
        .select('id, user_id')
        .eq('external_request_id', requestId)
        .single();

    if (fetchError || !job) {
        console.error(`[EnhancorAI-Webhook] Could not find job for request_id ${requestId}. Error:`, fetchError?.message);
        // Return success to the webhook service so it doesn't retry. The error is logged.
        return;
    }

    console.log(`[EnhancorAI-Webhook] Finalizing job ${job.id}. Downloading result from ${resultUrl}`);
    const imageResponse = await fetch(resultUrl);
    if (!imageResponse.ok) {
        throw new Error(`Failed to download final image from EnhancorAI: ${imageResponse.statusText}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    
    const filePath = `${job.user_id}/enhancor-results/${Date.now()}_${requestId}.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

    await supabase.from('enhancor_ai_jobs').update({
        status: 'complete',
        final_image_url: publicUrl
    }).eq('id', job.id);

    console.log(`[EnhancorAI-Webhook] Job ${job.id} successfully completed.`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    const { request_id, result, status } = payload;

    if (!request_id || !result || !status) {
      throw new Error("Webhook received an invalid payload. Missing request_id, result, or status.");
    }

    console.log(`[EnhancorAI-Webhook] Received notification for request_id: ${request_id}, status: ${status}`);

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    if (status === 'success') {
        await finalizeJob(supabase, request_id, result);
    } else {
        // Handle failed jobs from webhook
        await supabase.from('enhancor_ai_jobs')
            .update({ status: 'failed', error_message: `EnhancorAI reported failure via webhook. Status: ${status}` })
            .eq('external_request_id', request_id);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EnhancorAI-Webhook] Error:", error);
    // Return a 200 OK even on error to prevent the webhook service from retrying indefinitely.
    // The error is logged on our side for debugging.
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }
});