import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';

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
        throw new Error(`Could not parse bucket or path from URL: ${publicUrl}`);
    }

    console.log(`[BitStudioProxy] Downloading from bucket '${bucketName}' with path: ${filePath}`);
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

  try {
    const body = await req.json();
    const { user_id, mode, batch_pair_job_id } = body;
    if (!user_id || !mode) {
      throw new Error("user_id and mode are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const jobIds: string[] = [];

    if (mode === 'inpaint') {
      console.log(`[BitStudioProxy][${requestId}] Starting inpaint workflow.`);
      let { 
        full_source_image_base64,
        source_image_url,
        mask_image_base64, 
        mask_image_url, 
        prompt, 
        reference_image_base64,
        reference_image_url,
        is_garment_mode,
        num_attempts = 1, 
        denoise = 1.0, 
        mask_expansion_percent = 2,
        debug_assets
      } = body;
      
      console.log(`[BitStudioProxy][${requestId}] Inpaint mode received with prompt: "${prompt ? prompt.substring(0, 30) + '...' : 'N/A'}", Denoise: ${denoise}, Has Reference: ${!!reference_image_base64 || !!reference_image_url}`);

      if (!full_source_image_base64 && source_image_url) {
        console.log(`[BitStudioProxy][${requestId}] Source image base64 not found. Downloading from URL: ${source_image_url}`);
        const sourceBlob = await downloadFromSupabase(supabase, source_image_url);
        const sourceBuffer = await sourceBlob.arrayBuffer();
        full_source_image_base64 = encodeBase64(sourceBuffer);
        console.log(`[BitStudioProxy][${requestId}] Source image downloaded and encoded successfully.`);
      }

      if (!reference_image_base64 && reference_image_url) {
        console.log(`[BitStudioProxy][${requestId}] Reference image base64 not found. Downloading from URL: ${reference_image_url}`);
        const referenceBlob = await downloadFromSupabase(supabase, reference_image_url);
        const referenceBuffer = await referenceBlob.arrayBuffer();
        reference_image_base64 = encodeBase64(referenceBuffer);
        console.log(`[BitStudioProxy][${requestId}] Reference image downloaded and encoded successfully.`);
      }

      if (!full_source_image_base64 || (!mask_image_base64 && !mask_image_url)) {
        throw new Error("Missing required parameters for inpaint mode: full_source_image_base64 and one of mask_image_base64 or mask_image_url are required.");
      }
      
      let maskBlob: Blob;
      if (mask_image_url) {
          console.log(`[BitStudioProxy][${requestId}] Fetching mask from URL: ${mask_image_url}`);
          maskBlob = await getMaskBlob(supabase, mask_image_url);
      } else {
          maskBlob = new Blob([decodeBase64(mask_image_base64)], { type: 'image/png' });
      }
      
      const rawMaskImage = await loadImage(new Uint8Array(await maskBlob.arrayBuffer()));
      console.log(`[BitStudioProxy][${requestId}] Mask image loaded into memory.`);

      const dilatedCanvas = createCanvas(rawMaskImage.width(), rawMaskImage.height());
      const dilateCtx = dilatedCanvas.getContext('2d');
      
      const dilationAmount = Math.max(10, Math.round(rawMaskImage.width() * (mask_expansion_percent / 100)));
      dilateCtx.filter = `blur(${dilationAmount}px)`;
      dilateCtx.drawImage(rawMaskImage, 0, 0);
      dilateCtx.filter = 'none';
      console.log(`[BitStudioProxy][${requestId}] Mask dilated by ${dilationAmount}px.`);
      
      const dilatedImageData = dilateCtx.getImageData(0, 0, dilatedCanvas.width, dilatedCanvas.height);
      const data = dilatedImageData.data;
      let minX = dilatedCanvas.width, minY = dilatedCanvas.height, maxX = 0, maxY = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 128) {
          data[i] = data[i+1] = data[i+2] = 255;
          const x = (i / 4) % dilatedCanvas.width;
          const y = Math.floor((i / 4) / dilatedCanvas.width);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        } else {
          data[i] = data[i+1] = data[i+2] = 0;
        }
      }
      dilateCtx.putImageData(dilatedImageData, 0, 0);

      if (maxX < minX || maxY < minY) {
        throw new Error("The provided mask is empty or invalid after processing.");
      }

      const fullSourceImage = await loadImage(`data:image/png;base64,${full_source_image_base64}`);
      const padding = Math.round(Math.max(maxX - minX, maxY - minY) * 0.30);

      const x1 = Math.max(0, minX - padding);
      const y1 = Math.max(0, minY - padding);
      const x2 = Math.min(fullSourceImage.width(), maxX + padding);
      const y2 = Math.min(fullSourceImage.height(), maxY + padding);

      const width = x2 - x1;
      const height = y2 - y1;

      if (width <= 0 || height <= 0) {
        throw new Error(`Invalid bounding box dimensions calculated: ${width}x${height}. The mask might be too small or at the very edge of the image.`);
      }

      const bbox = { x: x1, y: y1, width, height };
      console.log(`[BitStudioProxy][${requestId}] Calculated bounding box: ${JSON.stringify(bbox)}`);

      const croppedCanvas = createCanvas(bbox.width, bbox.height);
      const cropCtx = croppedCanvas.getContext('2d');
      cropCtx.drawImage(fullSourceImage, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
      const croppedSourceBuffer = croppedCanvas.toBuffer('image/png');
      if (!croppedSourceBuffer) throw new Error("Failed to create buffer from cropped source canvas.");
      const croppedSourceBase64 = encodeBase64(croppedSourceBuffer);

      const croppedMaskCanvas = createCanvas(bbox.width, bbox.height);
      const cropMaskCtx = croppedMaskCanvas.getContext('2d');
      cropMaskCtx.drawImage(dilatedCanvas, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
      const croppedDilatedMaskBuffer = croppedMaskCanvas.toBuffer('image/png');
      if (!croppedDilatedMaskBuffer) throw new Error("Failed to create buffer from cropped mask canvas.");
      const croppedDilatedMaskBase64 = encodeBase64(croppedDilatedMaskBuffer);
      console.log(`[BitStudioProxy][${requestId}] Cropped source and mask to bounding box.`);

      let sourceToSendBase64 = croppedSourceBase64;
      let maskToSendBase64 = croppedDilatedMaskBase64;
      
      const TARGET_LONG_SIDE = 768;
      const cropLongestSide = Math.max(bbox.width, bbox.height);

      if (cropLongestSide < TARGET_LONG_SIDE) {
          const upscaleFactor = TARGET_LONG_SIDE / cropLongestSide;
          console.log(`[BitStudioProxy][${requestId}] Crop's longest side (${cropLongestSide}px) is below target of ${TARGET_LONG_SIDE}px. Upscaling by a factor of ${upscaleFactor.toFixed(2)}...`);
          
          const { data: upscaleData, error: upscaleError } = await supabase.functions.invoke('MIRA-AGENT-tool-upscale-crop', {
              body: {
                  source_crop_base64: croppedSourceBase64,
                  mask_crop_base64: croppedDilatedMaskBase64,
                  upscale_factor: upscaleFactor
              }
          });

          if (upscaleError) throw new Error(`Upscaling failed: ${upscaleError.message}`);
          
          sourceToSendBase64 = upscaleData.upscaled_source_base64;
          maskToSendBase64 = upscaleData.upscaled_mask_base64;
          console.log(`[BitStudioProxy][${requestId}] Upscaling complete. New crop dimensions will be approx ${Math.round(bbox.width * upscaleFactor)}x${Math.round(bbox.height * upscaleFactor)}.`);
      } else {
          console.log(`[BitStudioProxy][${requestId}] Crop's longest side (${cropLongestSide}px) is sufficient. Skipping upscale.`);
      }

      if (!prompt || prompt.trim() === "") {
        if (!reference_image_base64) {
            throw new Error("A text prompt is required when no reference image is provided.");
        }
        console.log(`[BitStudioProxy][${requestId}] No prompt provided. Auto-generating from reference...`);
        const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
          body: { 
            person_image_base64: sourceToSendBase64,
            person_image_mime_type: 'image/png',
            garment_image_base64: reference_image_base64,
            garment_image_mime_type: 'image/png',
            is_garment_mode: is_garment_mode ?? true
          }
        });
        if (promptError) throw new Error(`Auto-prompt generation failed: ${promptError.message}`);
        prompt = promptData.final_prompt;
        console.log(`[BitStudioProxy][${requestId}] Auto-prompt generated successfully.`);
      }

      if (!prompt) throw new Error("Prompt is required for inpainting.");

      for (let i = 0; i < num_attempts; i++) {
        console.log(`[BitStudioProxy][${requestId}] Starting attempt ${i + 1}/${num_attempts}.`);
        const sourceBlob = new Blob([decodeBase64(sourceToSendBase64)], { type: 'image/png' });
        const finalMaskBlob = new Blob([decodeBase64(maskToSendBase64)], { type: 'image/png' });

        const uploadPromises: Promise<{ type: string, id: string | null }>[] = [];

        console.log(`[BitStudioProxy][${requestId}] Attempt ${i + 1}: Uploading inpaint-base...`);
        uploadPromises.push(uploadToBitStudio(sourceBlob, 'inpaint-base', `source_${i}.png`).then(id => ({ type: 'source', id })));
        
        console.log(`[BitStudioProxy][${requestId}] Attempt ${i + 1}: Uploading inpaint-mask...`);
        uploadPromises.push(uploadToBitStudio(finalMaskBlob, 'inpaint-mask', `mask_${i}.png`).then(id => ({ type: 'mask', id })));

        if (reference_image_base64) {
          console.log(`[BitStudioProxy][${requestId}] Attempt ${i + 1}: Uploading inpaint-reference...`);
          const referenceBlob = new Blob([decodeBase64(reference_image_base64)], { type: 'image/png' });
          uploadPromises.push(uploadToBitStudio(referenceBlob, 'inpaint-reference', `reference_${i}.png`).then(id => ({ type: 'reference', id })));
        }

        const uploadResults = await Promise.all(uploadPromises);
        const sourceImageId = uploadResults.find(r => r.type === 'source')?.id;
        const maskImageId = uploadResults.find(r => r.type === 'mask')?.id;
        const referenceImageId = uploadResults.find(r => r.type === 'reference')?.id;

        if (!sourceImageId || !maskImageId) {
            throw new Error("Failed to upload essential source or mask images to BitStudio.");
        }
        console.log(`[BitStudioProxy][${requestId}] Attempt ${i + 1}: BitStudio Image IDs -> Source: ${sourceImageId}, Mask: ${maskImageId}, Reference: ${referenceImageId || 'N/A'}`);

        const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${sourceImageId}/inpaint`;
        const inpaintPayload: any = { 
            mask_image_id: maskImageId, 
            prompt, 
            resolution: 'high', 
            denoise,
            seed: Math.floor(Math.random() * 1000000000)
        };
        if (referenceImageId) inpaintPayload.reference_image_id = referenceImageId;
        
        console.log(`[BitStudioProxy][${requestId}] Attempt ${i + 1}: Sending final payload to BitStudio inpainting endpoint: ${inpaintUrl}`);
        console.log(JSON.stringify(inpaintPayload, null, 2));

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
        console.log(`[BitStudioProxy][${requestId}] Attempt ${i + 1}: Inpainting job queued with BitStudio. Version ID: ${newVersion.id}`);
        
        const metadataToSave = {
          bitstudio_version_id: newVersion.id,
          full_source_image_base64,
          cropped_source_image_base64: croppedSourceBase64,
          cropped_dilated_mask_base64: croppedDilatedMaskBase64,
          bbox,
          prompt_used: prompt,
          debug_assets: debug_assets || {}
        };

        const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
          user_id, mode, status: 'queued', bitstudio_task_id: inpaintResult.id,
          metadata: metadataToSave,
          batch_pair_job_id: batch_pair_job_id
        }).select('id').single();
        if (insertError) throw insertError;
        jobIds.push(newJob.id);
        console.log(`[BitStudioProxy][${requestId}] Attempt ${i + 1}: Job record created in DB with ID: ${newJob.id}`);
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