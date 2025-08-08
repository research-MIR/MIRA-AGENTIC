import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

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
  const filePath = decodeURIComponent(pathSegments.slice(publicSegmentIndex + 2).join('/'));

  if (!bucketName || !filePath) {
      throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
  }

  console.log(`[Downloader] Attempting to download from bucket: '${bucketName}', path: '${filePath}'`);

  const { data, error } = await supabase.storage.from(bucketName).download(filePath);
  if (error) {
      throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
  }
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
    let sourceImageUrlForCheck = null;

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
    const { retry_job_id, payload: retryPayload, new_source_image_id, existing_job_id } = body;

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
        
        const sourceIdForInpaint = retryPayload.person_image_id || new_source_image_id || jobToRetry.bitstudio_person_image_id;
        if (!sourceIdForInpaint) throw new Error("Cannot retry inpaint: missing source image ID.");
        
        const finalPayload = { ...retryPayload };
        delete finalPayload.person_image_id;

        if (finalPayload.resolution === 'hd') {
            console.log(`[BitStudioProxy][${requestId}] Mapping invalid resolution 'hd' to 'high'.`);
            finalPayload.resolution = 'high';
        }

        const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${sourceIdForInpaint}/inpaint`;
        apiResponse = await fetch(inpaintUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(finalPayload)
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
        bitstudio_person_image_id: new_source_image_id || jobToRetry.bitstudio_person_image_id,
        bitstudio_task_id: newTaskId,
        metadata: { ...jobToRetry.metadata, engine: 'bitstudio', prompt_used: retryPayload.prompt, retry_count: (jobToRetry.metadata.retry_count || 0) + 1 },
        error_message: null,
        last_polled_at: null // Reset the poll timestamp to make it immediately available to the poller
      }).eq('id', retry_job_id);
      if (updateError) throw updateError;

      // The watchdog will pick this up on its next run. No direct invocation needed.
      return new Response(JSON.stringify({ success: true, jobId: retry_job_id, message: "Job successfully retried." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      });

    } else {
      // --- NEW JOB LOGIC ---
      const { user_id, mode, batch_pair_job_id, vto_pack_job_id, metadata } = body;
      console.log(`[BitStudioProxy][${requestId}] Handling new job. Mode: ${mode}`);
      if (!user_id || !mode) throw new Error("user_id and mode are required for new jobs.");

      const jobIds: string[] = [];

      if (mode === 'inpaint') {
        // --- IDEMPOTENCY CHECK ---
        if (batch_pair_job_id) {
            const { data: existingJob, error: checkError } = await supabase
                .from('mira-agent-bitstudio-jobs')
                .select('id')
                .eq('batch_pair_job_id', batch_pair_job_id)
                .not('status', 'in', '(failed,permanently_failed)')
                .maybeSingle();
            if (checkError) throw checkError;
            if (existingJob) {
                console.log(`[BitStudioProxy][${requestId}] Idempotency check failed: An active job already exists for batch_pair_job_id ${batch_pair_job_id}. Skipping creation.`);
                return new Response(JSON.stringify({ success: true, message: "Job already exists and is active.", jobId: existingJob.id }), {
                    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                    status: 200,
                });
            }
        }
        // --- END IDEMPOTENCY CHECK ---

        const { source_cropped_url, mask_url, reference_image_url, prompt, denoise, resolution, num_images } = body;
        console.log(`[BitStudioProxy][${requestId}] Inpaint mode: Received source URL: ${source_cropped_url}, mask URL: ${mask_url}`);
        
        let sourceBlob: Blob;
        let maskBlob: Blob;

        if (source_cropped_url) {
            sourceBlob = await downloadFromSupabase(supabase, source_cropped_url);
        } else {
            throw new Error("Inpaint mode requires 'source_cropped_url'.");
        }

        if (mask_url) {
            const fullMaskBlob = await downloadFromSupabase(supabase, mask_url);
            const fullMaskImg = await ISImage.decode(await fullMaskBlob.arrayBuffer());
            const { bbox } = metadata;
            if (!bbox) throw new Error("Bbox metadata is required when providing a full mask URL.");
            const croppedMaskImg = fullMaskImg.clone().crop(bbox.x, bbox.y, bbox.width, bbox.height);
            const croppedMaskBuffer = await croppedMaskImg.encode(0);
            maskBlob = new Blob([croppedMaskBuffer], { type: 'image/png' });
        } else {
            throw new Error("Inpaint mode requires 'mask_url'.");
        }
        console.log(`[BitStudioProxy][${requestId}] Assets downloaded. Uploading to BitStudio...`);

        const [sourceImageId, maskImageId] = await Promise.all([
          uploadToBitStudio(sourceBlob, 'inpaint-base', 'source.png'),
          uploadToBitStudio(maskBlob, 'inpaint-mask', 'mask.png')
        ]);
        console.log(`[BitStudioProxy][${requestId}] Source and mask uploaded. Source ID: ${sourceImageId}, Mask ID: ${maskImageId}`);

        const inpaintPayload: any = {
          mask_image_id: maskImageId,
          prompt: prompt || "photorealistic",
          denoise: denoise || 0.99,
          resolution: resolution || 'high',
          num_images: num_images || 1,
        };

        let referenceImageId: string | null = null;
        if (reference_image_url) {
          console.log(`[BitStudioProxy][${requestId}] Reference image provided. Uploading...`);
          const referenceBlob = await downloadFromSupabase(supabase, reference_image_url);
          referenceImageId = await uploadToBitStudio(referenceBlob, 'inpaint-reference', 'reference.png');
          inpaintPayload.reference_image_id = referenceImageId;
          console.log(`[BitStudioProxy][${requestId}] Reference image uploaded. ID: ${referenceImageId}`);
        }

        const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${sourceImageId}/inpaint`;
        console.log(`[BitStudioProxy][${requestId}] Submitting inpaint job to BitStudio...`);
        const inpaintResponse = await fetch(inpaintUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(inpaintPayload)
        });
        if (!inpaintResponse.ok) throw new Error(`BitStudio inpaint request failed: ${await inpaintResponse.text()}`);
        
        const inpaintResult = await inpaintResponse.json();
        const taskId = inpaintResult.versions?.[0]?.id;
        if (!taskId) throw new Error("BitStudio did not return a task ID for the inpaint job.");
        console.log(`[BitStudioProxy][${requestId}] Inpaint job submitted. Task ID: ${taskId}`);

        const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
          user_id, mode, status: 'queued', 
          source_person_image_url: metadata?.full_source_image_url,
          source_garment_image_url: reference_image_url,
          bitstudio_person_image_id: sourceImageId, 
          bitstudio_garment_image_id: referenceImageId, 
          bitstudio_mask_image_id: maskImageId,
          bitstudio_task_id: taskId, 
          batch_pair_job_id: batch_pair_job_id, 
          vto_pack_job_id: vto_pack_job_id,
          metadata: { 
            ...metadata,
            engine: 'bitstudio',
            prompt_used: prompt,
            original_request_payload: inpaintPayload,
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
        if (!vtoResponse.ok) throw new Error(`BitStudio VTO retry request failed: ${await vtoResponse.text()}`);
        const vtoResult = await vtoResponse.json();
        const taskId = vtoResult[0]?.id;
        if (!taskId) throw new Error("BitStudio did not return a task ID for the VTO job.");

        if (existing_job_id) {
            console.log(`[BitStudioProxy][${requestId}] Updating existing job record: ${existing_job_id}`);
            const { error: updateError } = await supabase.from('mira-agent-bitstudio-jobs').update({
                status: 'queued',
                bitstudio_person_image_id: personImageId, 
                bitstudio_garment_image_id: outfitImageId, 
                bitstudio_task_id: taskId,
                metadata: {
                  ...metadata,
                  engine: 'bitstudio',
                  original_request_payload: vtoPayload
                }
            }).eq('id', existing_job_id);
            if (updateError) throw updateError;
            jobIds.push(existing_job_id);
        } else {
            const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
              user_id, mode, status: 'queued', source_person_image_url: person_image_url, source_garment_image_url: garment_image_url,
              bitstudio_person_image_id: personImageId, bitstudio_garment_image_id: outfitImageId, bitstudio_task_id: taskId,
              batch_pair_job_id: batch_pair_job_id,
              vto_pack_job_id: vto_pack_job_id,
              metadata: {
                engine: 'bitstudio',
                original_request_payload: vtoPayload
              }
            }).select('id').single();
            if (insertError) throw insertError;
            jobIds.push(newJob.id);
        }
      }

      // --- Proactively invoke the poller for all new jobs with retry ---
      for (const newJobId of jobIds) {
        console.log(`[BitStudioProxy][${requestId}] Proactively invoking poller for new job ID: ${newJobId}`);
        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            const { error: invokeError } = await supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: {} });
            if (!invokeError) {
                console.log(`[BitStudioProxy][${requestId}] Poller for job ${newJobId} invoked successfully on attempt ${attempt}.`);
                success = true;
                break;
            }
            console.warn(`[BitStudioProxy][${requestId}] Failed to invoke poller for job ${newJobId} on attempt ${attempt}:`, invokeError.message);
            if (attempt < 3) {
                const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s
                console.log(`[BitStudioProxy][${requestId}] Retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        if (!success) {
            console.error(`[BitStudioProxy][${requestId}] CRITICAL: Failed to invoke poller for job ${newJobId} after 3 attempts. The watchdog will have to recover it.`);
        }
      }

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