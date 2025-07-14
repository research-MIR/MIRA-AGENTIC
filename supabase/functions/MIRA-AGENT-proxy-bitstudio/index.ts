import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

type BitStudioImageType = 
  | 'virtual-try-on-person' 
  | 'virtual-try-on-outfit' 
  | 'inpaint-base' 
  | 'inpaint-mask'
  | 'inpaint-reference';

async function uploadToBitStudio(fileBlob: Blob, type: BitStudioImageType, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', fileBlob, filename);
  formData.append('type', type);

  const response = await fetch(`${BITSTUDIO_API_BASE}/images`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BitStudio upload failed for type ${type}: ${errorText}`);
  }
  const result = await response.json();
  if (!result.id) throw new Error(`BitStudio upload for ${type} did not return an ID.`);
  return result.id;
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    
    const publicSegmentIndex = pathSegments.indexOf('public');
    
    if (publicSegmentIndex === -1 || publicSegmentIndex + 1 >= pathSegments.length) {
        throw new Error(`Could not parse bucket name from URL: ${publicUrl}`);
    }

    const bucketName = pathSegments[publicSegmentIndex + 1];
    const filePath = pathSegments.slice(publicSegmentIndex + 2).join('/');

    if (!bucketName || !filePath) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
    }

    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) {
        throw new Error(`Failed to download from Supabase storage: ${error.message}`);
    }
    return data;
}

async function getMaskBlob(supabase: SupabaseClient, maskUrl: string): Promise<Blob> {
    const url = new URL(maskUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('object') + 2];
    const pathStartIndex = url.pathname.indexOf(bucketName) + bucketName.length + 1;
    const storagePath = decodeURIComponent(url.pathname.substring(pathStartIndex));

    if (!bucketName || !storagePath) {
        throw new Error(`Could not parse bucket or path from mask URL: ${maskUrl}`);
    }

    const { data, error } = await supabase.storage.from(bucketName).download(storagePath);
    if (error) throw new Error(`Failed to download mask from Supabase: ${error.message}`);
    return data;
}

serve(async (req) => {
  const requestId = `proxy-${Date.now()}`;
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  
  try {
    let body;
    let imageFile = null;
    let originalFilename = 'image.png';
    let sourceImageUrlForCheck: string | null = null;

    const contentType = req.headers.get('content-type');
    if (contentType && contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
      const image = formData.get('image');
      if (image instanceof File) {
        imageFile = image;
        originalFilename = image.name;
      }
    } else {
      body = await req.json();
      if (body.image_url) {
        sourceImageUrlForCheck = body.image_url;
        const imageResponse = await fetch(body.image_url);
        if (!imageResponse.ok) throw new Error(`Failed to download image from URL: ${imageResponse.statusText}`);
        imageFile = await imageResponse.blob();
        originalFilename = body.image_url.split('/').pop() || 'image.png';
      } else if (body.base64_image_data) {
        const imageBuffer = decodeBase64(body.base64_image_data);
        imageFile = new Blob([
          imageBuffer
        ], {
          type: body.mime_type || 'image/png'
        });
        originalFilename = 'agent_history_image.png';
      }
    }
    const { retry_job_id, payload: retryPayload } = body;

    if (retry_job_id) {
      // --- RETRY LOGIC ---
      console.log(`[BitStudioProxy][${requestId}] Handling retry for job ID: ${retry_job_id}`);
      const { data: jobToRetry, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', retry_job_id).single();
      if (fetchError) throw fetchError;

      if (!retryPayload) {
        throw new Error("Retry request is missing the 'payload' object from the orchestrator.");
      }

      let newTaskId: string;
      let apiResponse;

      if (jobToRetry.mode === 'inpaint') {
        console.log(`[BitStudioProxy][${requestId}] Executing INPAINT retry logic.`);
        const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${jobToRetry.bitstudio_person_image_id}/inpaint`;
        apiResponse = await fetch(inpaintUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(retryPayload)
        });
        if (!apiResponse.ok) throw new Error(`BitStudio inpaint retry request failed: ${await apiResponse.text()}`);
        const inpaintResult = await apiResponse.json();
        newTaskId = inpaintResult.versions?.[0]?.id;
        if (!newTaskId) throw new Error("BitStudio did not return a new task ID on inpaint retry.");
      } else { // Default to 'base' VTO
        console.log(`[BitStudioProxy][${requestId}] Executing BASE VTO retry logic.`);
        const vtoResponse = await fetch(`${BITSTUDIO_API_BASE}/images/virtual-try-on`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(retryPayload)
        });
        if (!vtoResponse.ok) throw new Error(`BitStudio VTO retry request failed: ${await vtoResponse.text()}`);
        const vtoResult = await vtoResponse.json();
        newTaskId = vtoResult[0]?.id;
        if (!newTaskId) throw new Error("BitStudio did not return a new task ID on retry.");
      }

      const { error: updateError } = await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'queued',
        bitstudio_task_id: newTaskId,
        metadata: { ...jobToRetry.metadata, prompt_used: retryPayload.prompt, retry_count: (jobToRetry.metadata.retry_count || 0) + 1 },
        error_message: null,
        last_polled_at: new Date().toISOString(),
      }).eq('id', retry_job_id);
      if (updateError) throw updateError;

      supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id: retry_job_id } }).catch(console.error);
      return new Response(JSON.stringify({ success: true, jobId: retry_job_id, message: "Job successfully retried." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else {
      // --- NEW JOB LOGIC ---
      console.log(`[BitStudioProxy][${requestId}] Handling new job creation.`);
      const { user_id, mode, batch_pair_job_id, vto_pack_job_id } = body;
      if (!user_id || !mode) throw new Error("user_id and mode are required for new jobs.");

      const jobIds: string[] = [];

      if (mode === 'inpaint') {
        const { source_image_url, mask_image_url, reference_image_url, prompt, denoise, resolution, mask_expansion_percent, num_images, debug_assets } = body;
        if (!source_image_url || !mask_image_url) throw new Error("source_image_url and mask_image_url are required for inpaint mode.");

        const [sourceBlob, maskBlob] = await Promise.all([
          downloadFromSupabase(supabase, source_image_url),
          getMaskBlob(supabase, mask_image_url)
        ]);

        const [sourceImageId, maskImageId] = await Promise.all([
          uploadToBitStudio(sourceBlob, 'inpaint-base', 'source.png'),
          uploadToBitStudio(maskBlob, 'inpaint-mask', 'mask.png')
        ]);

        const inpaintPayload: any = {
          mask_image_id: maskImageId,
          prompt: prompt || "photorealistic",
          denoise: denoise || 0.99,
          resolution: resolution || 'standard',
          mask_expansion_percent: mask_expansion_percent || 3,
          num_images: num_images || 1,
        };

        let referenceImageId: string | null = null;
        if (reference_image_url) {
          const referenceBlob = await downloadFromSupabase(supabase, reference_image_url);
          referenceImageId = await uploadToBitStudio(referenceBlob, 'inpaint-reference', 'reference.png');
          inpaintPayload.reference_image_id = referenceImageId;
        }

        const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${sourceImageId}/inpaint`;
        const inpaintResponse = await fetch(inpaintUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(inpaintPayload)
        });
        if (!inpaintResponse.ok) throw new Error(`BitStudio inpaint request failed: ${await inpaintResponse.text()}`);
        
        const inpaintResult = await inpaintResponse.json();
        const taskId = inpaintResult.versions?.[0]?.id;
        if (!taskId) throw new Error("BitStudio did not return a task ID for the inpaint job.");

        const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
          user_id, mode, status: 'queued', source_person_image_url: source_image_url, source_garment_image_url: reference_image_url,
          bitstudio_person_image_id: sourceImageId, bitstudio_garment_image_id: referenceImageId, bitstudio_task_id: taskId, batch_pair_job_id: batch_pair_job_id, vto_pack_job_id: vto_pack_job_id,
          metadata: { 
            prompt_used: prompt,
            debug_assets: debug_assets,
            bitstudio_version_id: taskId,
            bitstudio_mask_image_id: maskImageId,
            source_image_url: source_image_url,
            mask_image_url: mask_image_url,
            reference_image_url: reference_image_url,
            original_request_payload: inpaintPayload, // Save the original request
          }
        }).select('id').single();
        if (insertError) throw insertError;
        jobIds.push(newJob.id);

      } else { // Default to virtual-try-on
        const { person_image_url, garment_image_url, num_images, prompt, prompt_appendix } = body;
        if (!person_image_url || !garment_image_url) throw new Error("person_image_url and garment_image_url are required for try-on mode.");

        const [personBlob, garmentBlob] = await Promise.all([
          downloadFromSupabase(supabase, person_image_url),
          downloadFromSupabase(supabase, garment_image_url)
        ]);

        const [personImageId, outfitImageId] = await Promise.all([
          uploadToBitStudio(personBlob, 'virtual-try-on-person', 'person.webp'),
          uploadToBitStudio(garmentBlob, 'virtual-try-on-outfit', 'garment.webp')
        ]);

        const vtoUrl = `${BITSTUDIO_API_BASE}/images/virtual-try-on`;
        const vtoPayload: any = {
          person_image_id: personImageId,
          outfit_image_id: outfitImageId,
          resolution: 'high',
          num_images: num_images || 1,
        };
        if (prompt) vtoPayload.prompt = prompt;
        if (prompt_appendix) vtoPayload.prompt_appendix = prompt_appendix;

        const vtoResponse = await fetch(vtoUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(vtoPayload)
        });
        if (!vtoResponse.ok) throw new Error(`BitStudio VTO request failed: ${await vtoResponse.text()}`);
        const vtoResult = await vtoResponse.json();
        const taskId = vtoResult[0]?.id;
        if (!taskId) throw new Error("BitStudio did not return a task ID for the VTO job.");

        const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
          user_id, mode, status: 'queued', source_person_image_url: person_image_url, source_garment_image_url: garment_image_url,
          bitstudio_person_image_id: personImageId, bitstudio_garment_image_id: outfitImageId, bitstudio_task_id: taskId,
          batch_pair_job_id: batch_pair_job_id,
          vto_pack_job_id: vto_pack_job_id,
          metadata: {
            original_request_payload: vtoPayload // Save the original request
          }
        }).select('id').single();
        if (insertError) throw insertError;
        jobIds.push(newJob.id);
      }

      jobIds.forEach(jobId => {
        supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id: jobId } }).catch(console.error);
      });

      return new Response(JSON.stringify({ success: true, jobIds }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }
  } catch (error) {
    console.error(`[BitStudioProxy][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});