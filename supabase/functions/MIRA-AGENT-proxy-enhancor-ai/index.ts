import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ENHANCOR_API_KEY = Deno.env.get('ENHANCOR_API_KEY');
const API_BASE = 'https://api.enhancor.ai/api';

const processJob = async (supabase: any, imageUrl: string, user_id: string, enhancor_mode: string, enhancor_params: any, batch_job_id: string | null, webhookUrl: string, tile_id: string | null, metadata: any) => {
    const logPrefix = `[EnhancorAIProxy][${imageUrl.split('/').pop()}]`;
    console.log(`${logPrefix} Starting processing.`);

    const { data: newJob, error: insertError } = await supabase
      .from('enhancor_ai_jobs')
      .insert({
        user_id,
        source_image_url: imageUrl, // This is now the pre-converted URL
        status: 'queued',
        enhancor_mode,
        enhancor_params,
        metadata: { ...metadata, batch_job_id: batch_job_id, tile_id: tile_id }
      })
      .select('id')
      .single();
    if (insertError) throw new Error(`Failed to create job record: ${insertError.message}`);
    const jobId = newJob.id;

    let endpoint = '';
    let finalWebhookUrl = `${webhookUrl}?job_id=${jobId}`;
    if (tile_id) {
        finalWebhookUrl += `&tile_id=${tile_id}`;
    }

    const payload: any = {
      img_url: imageUrl,
      webhookUrl: finalWebhookUrl,
    };

    switch (enhancor_mode) {
      case 'portrait':
        endpoint = '/upscaler/v1/queue';
        payload.mode = enhancor_params?.mode || 'professional';
        break;
      case 'general':
        endpoint = '/image-upscaler/v1/queue';
        break;
      case 'detailed':
        endpoint = '/detailed/v1/queue';
        break;
      default:
        throw new Error(`Invalid enhancor_mode: ${enhancor_mode}`);
    }

    const fullApiUrl = `${API_BASE}${endpoint}`;
    const headers = { 'Content-Type': 'application/json', 'x-api-key': ENHANCOR_API_KEY! };

    console.log(`${logPrefix} Preparing to call EnhancorAI. URL: ${fullApiUrl}`);
    console.log(`${logPrefix} Payload: ${JSON.stringify(payload, null, 2)}`);

    const apiResponse = await fetch(fullApiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      throw new Error(`EnhancorAI API failed with status ${apiResponse.status}: ${errorBody}`);
    }

    const result = await apiResponse.json();
    if (!result.success || !result.requestId) {
      throw new Error("EnhancorAI did not return a successful response or requestId.");
    }

    await supabase
      .from('enhancor_ai_jobs')
      .update({ external_request_id: result.requestId, status: 'processing' })
      .eq('id', jobId);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!ENHANCOR_API_KEY) {
      throw new Error("The ENHANCOR_API_KEY is not set in the server environment.");
    }

    const { user_id, source_image_urls, enhancor_mode, enhancor_params, batch_job_id, tile_id, metadata } = await req.json();
    if (!user_id || !source_image_urls || !Array.isArray(source_image_urls) || source_image_urls.length === 0 || !enhancor_mode) {
      throw new Error("user_id, a non-empty source_image_urls array, and enhancor_mode are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const webhookUrl = `${SUPABASE_URL}/functions/v1/MIRA-AGENT-webhook-enhancor-ai`;

    // Fire-and-forget: Start processing but don't wait for it to finish.
    Promise.allSettled(
      source_image_urls.map(url => 
        processJob(supabase, url, user_id, enhancor_mode, enhancor_params, batch_job_id, webhookUrl, tile_id, metadata)
      )
    ).then(results => {
      const failedCount = results.filter(r => r.status === 'rejected').length;
      if (failedCount > 0) {
        console.error(`[EnhancorAIProxy] ${failedCount} out of ${source_image_urls.length} jobs failed to process in the background.`);
      } else {
        console.log(`[EnhancorAIProxy] All ${source_image_urls.length} jobs processed successfully in the background.`);
      }
    });

    // Return an immediate response to the client.
    return new Response(JSON.stringify({ success: true, message: `Queued ${source_image_urls.length} jobs for processing.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EnhancorAIProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});