import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ENHANCOR_API_KEY = Deno.env.get('ENHANCOR_API_KEY');
const WEBHOOK_BASE_URL = `${SUPABASE_URL}/functions/v1/MIRA-AGENT-webhook-EnhancorAI`;
const STALLED_THRESHOLD_MINUTES = 5;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const serviceEndpoints: { [key: string]: string } = {
    portrait: 'https://api.enhancor.ai/api/upscaler/v1',
    general: 'https://api.enhancor.ai/api/image-upscaler/v1',
    detailed: 'https://api.enhancor.ai/api/detailed/v1'
};

async function processQueuedJob(supabase: SupabaseClient, job: any) {
    const logPrefix = `[EnhancorAI-Poller][Queued][${job.id}]`;
    console.log(`${logPrefix} Processing job with mode: ${job.enhancor_mode}`);

    if (!ENHANCOR_API_KEY) {
        throw new Error("ENHANCOR_API_KEY secret is not set.");
    }

    const baseUrl = serviceEndpoints[job.enhancor_mode];
    if (!baseUrl) {
        throw new Error(`Invalid enhancor_mode '${job.enhancor_mode}' found in job.`);
    }

    const payload: any = {
        img_url: job.source_image_url,
        webhookUrl: WEBHOOK_BASE_URL
    };

    if (job.enhancor_mode === 'portrait') {
        payload.mode = job.enhancor_params?.mode || 'professional'; // Default to professional
    }

    const response = await fetch(`${baseUrl}/queue`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ENHANCOR_API_KEY
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`EnhancorAI API failed to queue job: ${errorText}`);
    }

    const result = await response.json();
    if (!result.success || !result.requestId) {
        throw new Error("EnhancorAI API did not return a successful response or requestId.");
    }

    await supabase.from('enhancor_ai_jobs').update({
        status: 'processing',
        external_request_id: result.requestId
    }).eq('id', job.id);

    console.log(`${logPrefix} Job successfully queued with EnhancorAI. Request ID: ${result.requestId}`);
}

async function processStalledJob(supabase: SupabaseClient, job: any) {
    const logPrefix = `[EnhancorAI-Poller][Stalled][${job.id}]`;
    console.log(`${logPrefix} Checking status for stalled job.`);

    const baseUrl = serviceEndpoints[job.enhancor_mode];
    const response = await fetch(`${baseUrl}/status`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': ENHANCOR_API_KEY!
        },
        body: JSON.stringify({ request_id: job.external_request_id })
    });

    if (!response.ok) {
        console.error(`${logPrefix} Failed to get status from EnhancorAI. Response: ${await response.text()}`);
        return; // Don't fail the job, just wait for next poll
    }

    const statusData = await response.json();
    const enhancorStatus = statusData.status;

    if (enhancorStatus === 'COMPLETED') {
        console.log(`${logPrefix} Job is COMPLETED. The webhook should have handled it, but we will finalize it now as a fallback.`);
        // The webhook payload has a 'result' key, but the status endpoint does not.
        // We can't finalize from here without the result URL. We'll have to rely on the webhook.
        // We can mark it as stalled so an admin can investigate.
        await supabase.from('enhancor_ai_jobs').update({
            error_message: 'Job completed but webhook failed. Manual recovery needed.'
        }).eq('id', job.id);

    } else if (enhancorStatus === 'FAILED') {
        console.error(`${logPrefix} Job FAILED according to EnhancorAI.`);
        await supabase.from('enhancor_ai_jobs').update({
            status: 'failed',
            error_message: 'EnhancorAI reported the job as FAILED.'
        }).eq('id', job.id);
    } else {
        console.log(`${logPrefix} Job is still in progress (${enhancorStatus}). Resetting poll timer.`);
        // The updated_at timestamp will be updated by the main loop, resetting the stall timer.
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  
  try {
    // 1. Process queued jobs
    const { data: queuedJobs, error: queuedError } = await supabase
      .from('enhancor_ai_jobs')
      .select('*')
      .eq('status', 'queued')
      .limit(5); // Process 5 at a time

    if (queuedError) throw queuedError;

    if (queuedJobs && queuedJobs.length > 0) {
        console.log(`[EnhancorAI-Poller] Found ${queuedJobs.length} queued jobs to process.`);
        const queuedPromises = queuedJobs.map(job => processQueuedJob(supabase, job).catch(async (e) => {
            console.error(`[EnhancorAI-Poller][Queued][${job.id}] Error:`, e.message);
            await supabase.from('enhancor_ai_jobs').update({ status: 'failed', error_message: e.message }).eq('id', job.id);
        }));
        await Promise.allSettled(queuedPromises);
    }

    // 2. Check for stalled jobs
    const threshold = new Date(Date.now() - STALLED_THRESHOLD_MINUTES * 60 * 1000).toISOString();
    const { data: stalledJobs, error: stalledError } = await supabase
      .from('enhancor_ai_jobs')
      .select('*')
      .eq('status', 'processing')
      .lt('updated_at', threshold)
      .limit(10);

    if (stalledError) throw stalledError;

    if (stalledJobs && stalledJobs.length > 0) {
        console.log(`[EnhancorAI-Poller] Found ${stalledJobs.length} stalled jobs to check.`);
        const stalledPromises = stalledJobs.map(job => processStalledJob(supabase, job).catch(e => {
            console.error(`[EnhancorAI-Poller][Stalled][${job.id}] Error:`, e.message);
            // Don't fail the job, just log the error and let the watchdog retry
        }));
        await Promise.allSettled(stalledPromises);
    }

    return new Response(JSON.stringify({ success: true, message: "Poller run complete." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EnhancorAI-Poller] Unhandled Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});