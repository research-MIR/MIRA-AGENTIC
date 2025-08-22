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

const fetchWithRetry = async (url: string, options: any, maxRetries = 3, initialDelay = 2000) => {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                return response;
            }
            console.warn(`[FetchRetry] Attempt ${attempt} failed with status ${response.status}.`);
            if (attempt === maxRetries) {
                throw new Error(`API call failed after ${maxRetries} attempts. Status: ${response.status}, Body: ${await response.text()}`);
            }
        } catch (error) {
            console.warn(`[FetchRetry] Attempt ${attempt} failed with network error: ${error.message}`);
            if (attempt === maxRetries) {
                throw error;
            }
        }
        // Exponential backoff with jitter
        const jitter = Math.random() * 1000; // Add up to 1 second of randomness
        const backoffDelay = initialDelay * Math.pow(2, attempt - 1);
        console.log(`[FetchRetry] Retrying in ${(backoffDelay + jitter).toFixed(0)}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffDelay + jitter));
    }
    throw new Error("Fetch with retry failed unexpectedly.");
};

const processJob = async (supabase: any, imageUrl: string, user_id: string, enhancor_mode: string, enhancor_params: any, batch_job_id: string | null, webhookUrl: string, tile_id: string | null, metadata: any) => {
    const logPrefix = `[EnhancorAIProxy][${imageUrl.split('/').pop()}]`;
    let jobId: string | null = null;

    try {
        console.log(`${logPrefix} Starting processing. User: ${user_id}, Mode: ${enhancor_mode}, TileID: ${tile_id}`);

        const insertPayload = {
            user_id,
            source_image_url: imageUrl,
            status: 'queued',
            enhancor_mode,
            enhancor_params,
            metadata: { ...metadata, batch_job_id: batch_job_id, tile_id: tile_id }
        };
        console.log(`${logPrefix} Preparing to insert job record into 'enhancor_ai_jobs'. Payload:`, JSON.stringify(insertPayload));

        const { data: newJob, error: insertError } = await supabase
          .from('enhancor_ai_jobs')
          .insert(insertPayload)
          .select('id')
          .single();
        
        if (insertError) {
            console.error(`${logPrefix} DATABASE INSERT FAILED:`, insertError);
            throw new Error(`Failed to create job record: ${insertError.message}`);
        }
        
        jobId = newJob.id;
        console.log(`${logPrefix} Job record created successfully. DB Job ID: ${jobId}`);

        let endpoint = '';
        let finalWebhookUrl = `${webhookUrl}?job_id=${jobId}`;
        if (tile_id) {
            finalWebhookUrl += `&tile_id=${tile_id}`;
        }

        const apiPayload: any = {
          img_url: imageUrl,
          webhookUrl: finalWebhookUrl,
        };

        const mode = String(enhancor_mode).trim();
        console.log(`${logPrefix} Sanitized enhancor_mode for switch: '${mode}'`);

        switch (mode) {
          case 'portrait':
            endpoint = '/upscaler/v1/queue';
            apiPayload.mode = enhancor_params?.mode || 'professional';
            break;
          case 'general':
          case 'enhancor_general':
            endpoint = '/image-upscaler/v1/queue';
            break;
          case 'detailed':
          case 'enhancor_detailed':
            endpoint = '/detailed/v1/queue';
            break;
          default:
            throw new Error(`Invalid enhancor_mode: ${enhancor_mode}`);
        }
        console.log(`${logPrefix} API payload constructed for endpoint '${endpoint}'.`);

        const fullApiUrl = `${API_BASE}${endpoint}`;
        const headers = { 'Content-Type': 'application/json', 'x-api-key': ENHANCOR_API_KEY! };

        console.log(`${logPrefix} Preparing to call EnhancorAI API. URL: ${fullApiUrl}`);
        console.log(`${logPrefix} API Payload: ${JSON.stringify(apiPayload, null, 2)}`);

        const apiResponse = await fetchWithRetry(fullApiUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(apiPayload),
        });

        const result = await apiResponse.json();
        console.log(`${logPrefix} EnhancorAI API call successful. Response:`, JSON.stringify(result));

        if (!result.success || !result.requestId) {
          throw new Error("EnhancorAI did not return a successful response or requestId.");
        }

        console.log(`${logPrefix} Updating job record with external request ID: ${result.requestId}`);
        await supabase
          .from('enhancor_ai_jobs')
          .update({ external_request_id: result.requestId, status: 'processing' })
          .eq('id', jobId);
        
        console.log(`${logPrefix} Job successfully dispatched and DB updated. Processing complete.`);

    } catch (error) {
        console.error(`${logPrefix} An error occurred during processing:`, error);
        if (jobId) {
            console.log(`${logPrefix} Attempting to mark job ${jobId} as failed in the database.`);
            await supabase.from('enhancor_ai_jobs').update({ status: 'failed', error_message: error.message }).eq('id', jobId);
        }
        throw error;
    }
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