import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_BASE_URL = 'https://api.bitstudio.ai';

async function uploadToBitStudio(supabase: SupabaseClient, imageUrl: string, type: 'virtual-try-on-person' | 'virtual-try-on-outfit') {
    // Download from Supabase
    const url = new URL(imageUrl);
    const pathParts = url.pathname.split('/public/mira-agent-user-uploads/');
    if (pathParts.length < 2) throw new Error(`Could not parse storage path from URL: ${imageUrl}`);
    const storagePath = decodeURIComponent(pathParts[1]);
    
    const { data: blob, error: downloadError } = await supabase.storage.from('mira-agent-user-uploads').download(storagePath);
    if (downloadError) throw new Error(`Supabase download failed for ${storagePath}: ${downloadError.message}`);

    // Upload to bitStudio
    const formData = new FormData();
    formData.append('file', blob, storagePath.split('/').pop());
    formData.append('type', type);

    const response = await fetch(`${BITSTUDIO_BASE_URL}/images`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` },
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`bitStudio upload failed for ${type}: ${errorText}`);
    }
    const result = await response.json();
    return result.id;
}

serve(async (req) => {
  const { job_id, prompt } = await req.json();
  if (!job_id) return new Response(JSON.stringify({ error: "job_id is required." }), { status: 400, headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'uploading' }).eq('id', job_id);
    const { data: job, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const personImageId = await uploadToBitStudio(supabase, job.source_person_image_url, 'virtual-try-on-person');
    const garmentImageId = await uploadToBitStudio(supabase, job.source_garment_image_url, 'virtual-try-on-outfit');

    await supabase.from('mira-agent-bitstudio-jobs').update({ 
        bitstudio_person_image_id: personImageId,
        bitstudio_garment_image_id: garmentImageId,
        status: 'processing'
    }).eq('id', job_id);

    const tryOnPayload: any = {
        person_image_id: personImageId,
        outfit_image_id: garmentImageId,
        resolution: "high",
        num_images: 1
    };

    if (prompt) {
        tryOnPayload.prompt = prompt;
    }

    const tryOnResponse = await fetch(`${BITSTUDIO_BASE_URL}/images/virtual-try-on`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(tryOnPayload)
    });

    if (!tryOnResponse.ok) {
        const errorText = await tryOnResponse.text();
        throw new Error(`bitStudio virtual try-on failed: ${errorText}`);
    }

    const tryOnResult = await tryOnResponse.json();
    const taskId = tryOnResult[0]?.id;
    if (!taskId) throw new Error("bitStudio did not return a task ID for the try-on job.");

    await supabase.from('mira-agent-bitstudio-jobs').update({ bitstudio_task_id: taskId }).eq('id', job_id);

    // Kick off the poller
    supabase.functions.invoke('MIRA-AGENT-poller-bitstudio-vto', { body: { job_id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[BitStudioWorker][${job_id}] Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});