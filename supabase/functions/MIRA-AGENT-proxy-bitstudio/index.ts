import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UPLOAD_BUCKET = 'mira-agent-user-uploads';

async function uploadImageToComfyUI(comfyUiUrl: string, imageBlob: Blob, filename: string) {
  const formData = new FormData();
  formData.append('image', imageBlob, filename);
  formData.append('overwrite', 'true');
  const uploadUrl = `${comfyUiUrl}/upload/image`;
  const response = await fetch(uploadUrl, { method: 'POST', body: formData });
  if (!response.ok) throw new Error(`ComfyUI upload failed: ${await response.text()}`);
  const data = await response.json();
  return data.name;
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathStartIndex = url.pathname.indexOf(UPLOAD_BUCKET);
    if (pathStartIndex === -1) {
        throw new Error(`Could not find bucket name '${UPLOAD_BUCKET}' in URL path: ${publicUrl}`);
    }
    const filePath = decodeURIComponent(url.pathname.substring(pathStartIndex + UPLOAD_BUCKET.length + 1));

    if (!filePath) {
        throw new Error(`Could not parse file path from URL: ${publicUrl}`);
    }

    console.log(`[BitStudioProxy] Downloading from storage path: ${filePath}`);
    const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath);

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

  try {
    const body = await req.json();
    const { user_id, mode, batch_pair_job_id } = body;
    if (!user_id || !mode) {
      throw new Error("user_id and mode are required.");
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jobIds: string[] = [];

    if (mode === 'inpaint') {
      console.log(`[BitStudioProxy][${requestId}] Starting inpaint workflow.`);
      let { 
        full_source_image_base64, source_image_url,
        mask_image_base64, mask_image_url, 
        reference_image_base64, reference_image_url,
        prompt,
        num_attempts = 1, denoise = 1.0,
        debug_assets
      } = body;
      
      console.log(`[BitStudioProxy][${requestId}] Inpaint mode received with prompt: "${prompt ? prompt.substring(0, 30) + '...' : 'N/A'}", Denoise: ${denoise}, Has Reference: ${!!reference_image_base64 || !!reference_image_url}`);

      if (!full_source_image_base64 && !source_image_url) throw new Error("Either full_source_image_base64 or source_image_url is required for inpaint mode.");
      if (!mask_image_base64 && !mask_image_url) throw new Error("Either mask_image_base64 or mask_image_url is required for inpaint mode.");

      let sourceBlob: Blob;
      if (source_image_url) {
        sourceBlob = await downloadFromSupabase(supabase, source_image_url);
      } else {
        sourceBlob = new Blob([decodeBase64(full_source_image_base64)], { type: 'image/png' });
      }

      let maskBlob: Blob;
      if (mask_image_url) {
        maskBlob = await getMaskBlob(supabase, mask_image_url);
      } else {
        maskBlob = new Blob([decodeBase64(mask_image_base64)], { type: 'image/png' });
      }

      let referenceBlob: Blob | null = null;
      if (reference_image_url) {
        referenceBlob = await downloadFromSupabase(supabase, reference_image_url);
      } else if (reference_image_base64) {
        referenceBlob = new Blob([decodeBase64(reference_image_base64)], { type: 'image/png' });
      }

      for (let i = 0; i < num_attempts; i++) {
        console.log(`[BitStudioProxy][${requestId}] Starting attempt ${i + 1}/${num_attempts}.`);
        
        const uploadPromises: Promise<{ type: string, id: string | null }>[] = [];
        uploadPromises.push(uploadToBitStudio(sourceBlob, 'inpaint-base', `source_${i}.png`).then(id => ({ type: 'source', id })));
        uploadPromises.push(uploadToBitStudio(maskBlob, 'inpaint-mask', `mask_${i}.png`).then(id => ({ type: 'mask', id })));
        if (referenceBlob) {
          uploadPromises.push(uploadToBitStudio(referenceBlob, 'inpaint-reference', `reference_${i}.png`).then(id => ({ type: 'reference', id })));
        }

        const uploadResults = await Promise.all(uploadPromises);
        const sourceImageId = uploadResults.find(r => r.type === 'source')?.id;
        const maskImageId = uploadResults.find(r => r.type === 'mask')?.id;
        const referenceImageId = uploadResults.find(r => r.type === 'reference')?.id;

        if (!sourceImageId || !maskImageId) throw new Error("Failed to upload essential source or mask images to BitStudio.");
        
        const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${sourceImageId}/inpaint`;
        const inpaintPayload: any = { 
            mask_image_id: maskImageId, 
            prompt, 
            resolution: 'high', 
            denoise,
            seed: Math.floor(Math.random() * 1000000000)
        };
        if (referenceImageId) inpaintPayload.reference_image_id = referenceImageId;
        
        const inpaintResponse = await fetch(inpaintUrl, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(inpaintPayload)
        });
        const responseText = await inpaintResponse.text();
        if (!inpaintResponse.ok) throw new Error(`BitStudio inpainting request failed: ${responseText}`);
        
        const inpaintResult = JSON.parse(responseText);
        const newVersion = inpaintResult.versions?.[0];
        if (!newVersion || !newVersion.id) throw new Error("BitStudio did not return a valid version object for the inpainting job.");
        
        const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
          user_id, mode, status: 'queued', bitstudio_task_id: inpaintResult.id,
          metadata: {
            bitstudio_version_id: newVersion.id,
            prompt_used: prompt,
            debug_assets: debug_assets || {}
          },
          batch_pair_job_id: batch_pair_job_id
        }).select('id').single();
        if (insertError) throw insertError;
        jobIds.push(newJob.id);
      }

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
        batch_pair_job_id: batch_pair_job_id
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

  } catch (error) {
    console.error(`[BitStudioProxy][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});