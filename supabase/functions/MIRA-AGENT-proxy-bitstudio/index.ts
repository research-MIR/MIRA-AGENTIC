import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const UPLOAD_BUCKET = 'mira-agent-user-uploads';
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';

const workflowTemplate = `{
  "3": { "inputs": { "seed": 1062983749859779, "steps": 20, "cfg": 1, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["39", 0], "positive": ["38", 0], "negative": ["38", 1], "latent_image": ["38", 2] }, "class_type": "KSampler", "_meta": { "title": "KSampler" } },
  "7": { "inputs": { "text": "", "clip": ["34", 0] }, "class_type": "CLIPTextEncode", "_meta": { "title": "CLIP Text Encode (Negative Prompt)" } },
  "8": { "inputs": { "samples": ["3", 0], "vae": ["32", 0] }, "class_type": "VAEDecode", "_meta": { "title": "VAE Decode" } },
  "9": { "inputs": { "filename_prefix": "ComfyUI_Inpaint", "images": ["54", 0] }, "class_type": "SaveImage", "_meta": { "title": "Save Image" } },
  "17": { "inputs": { "image": "source_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Input Image" } },
  "23": { "inputs": { "text": "Wearing pink Maxi Dress", "clip": ["34", 0] }, "class_type": "CLIPTextEncode", "_meta": { "title": "PROMPT" } },
  "26": { "inputs": { "guidance": 30, "conditioning": ["23", 0] }, "class_type": "FluxGuidance", "_meta": { "title": "FluxGuidance" } },
  "31": { "inputs": { "unet_name": "fluxfill.safetensors", "weight_dtype": "default" }, "class_type": "UNETLoader", "_meta": { "title": "Load Diffusion Model" } },
  "32": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader", "_meta": { "title": "Load VAE" } },
  "34": { "inputs": { "clip_name1": "clip_l.safetensors", "clip_name2": "t5xxl_fp16.safetensors", "type": "flux", "device": "default" }, "class_type": "DualCLIPLoader", "_meta": { "title": "DualCLIPLoader" } },
  "38": { "inputs": { "noise_mask": false, "positive": ["51", 0], "negative": ["7", 0], "vae": ["32", 0], "pixels": ["17", 0], "mask": ["53", 0] }, "class_type": "InpaintModelConditioning", "_meta": { "title": "InpaintModelConditioning" } },
  "39": { "inputs": { "model": ["31", 0] }, "class_type": "DifferentialDiffusion", "_meta": { "title": "Differential Diffusion" } },
  "45": { "inputs": { "image": "mask_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Input Mask" } },
  "47": { "inputs": { "channel": "red", "image": ["45", 0] }, "class_type": "ImageToMask", "_meta": { "title": "Convert Image to Mask" } },
  "48": { "inputs": { "style_model_name": "fluxcontrolnetupscale.safetensors" }, "class_type": "StyleModelLoader", "_meta": { "title": "Load Style Model" } },
  "49": { "inputs": { "clip_name": "sigclip_vision_patch14_384.safetensors" }, "class_type": "CLIPVisionLoader", "_meta": { "title": "Load CLIP Vision" } },
  "50": { "inputs": { "crop": "none", "clip_vision": ["49", 0], "image": ["52", 0] }, "class_type": "CLIPVisionEncode", "_meta": { "title": "CLIP Vision Encode" } },
  "51": { "inputs": { "strength": 0.30000000000000004, "strength_type": "attn_bias", "conditioning": ["26", 0], "style_model": ["48", 0], "clip_vision_output": ["50", 0] }, "class_type": "StyleModelApply", "_meta": { "title": "Apply Style Model" } },
  "52": { "inputs": { "image": "reference_image.png" }, "class_type": "LoadImage", "_meta": { "title": "Input Reference" } },
  "53": { "inputs": { "expand": 20, "incremental_expandrate": 0, "tapered_corners": true, "flip_input": false, "blur_radius": 3.1, "lerp_alpha": 1, "decay_factor": 1, "fill_holes": false, "mask": ["47", 0] }, "class_type": "GrowMaskWithBlur", "_meta": { "title": "Grow Mask With Blur" } },
  "54": { "inputs": { "method": "mkl", "strength": 0.30000000000000004, "image_ref": ["17", 0], "image_target": ["8", 0] }, "class_type": "ColorMatch", "_meta": { "title": "Color Match" } }
}`;

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

async function uploadToSupabaseStorage(supabase: SupabaseClient, blob: Blob, userId: string, filename: string): Promise<string> {
    const filePath = `${userId}/inpainting-sources/${Date.now()}-${filename}`;
    const { error } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, blob, { upsert: true });
    if (error) throw new Error(`Supabase storage upload failed: ${error.message}`);
    const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);
    return publicUrl;
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const filePath = url.pathname.split(`/${UPLOAD_BUCKET}/`)[1];
    if (!filePath) {
        throw new Error(`Could not parse file path from URL: ${publicUrl}`);
    }

    const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).download(decodeURIComponent(filePath));

    if (error) {
        throw new Error(`Failed to download from Supabase storage: ${error.message}`);
    }
    return data;
}

const getMaskBlob = downloadFromSupabase;

async function uploadToBitStudio(imageBlob: Blob, category: string, filename: string) {
    const formData = new FormData();
    formData.append('image', imageBlob, filename);
    formData.append('category', category);
    const uploadUrl = `${BITSTUDIO_API_BASE}/images/upload`;
    const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` },
        body: formData
    });
    if (!response.ok) throw new Error(`BitStudio upload failed: ${await response.text()}`);
    const data = await response.json();
    return data.id;
}

serve(async (req) => {
  const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
  const requestId = `proxy-inpainting-${Date.now()}`;
  console.log(`[InpaintingProxy][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (!COMFYUI_ENDPOINT_URL) throw new Error("COMFYUI_ENDPOINT_URL is not set.");

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json();
    console.log(`[InpaintingProxy][${requestId}] Received full payload:`, JSON.stringify(body, null, 2));

    const {
      user_id,
      mode,
      batch_pair_job_id
    } = body;

    if (!user_id || !mode) {
      throw new Error("user_id and mode are required.");
    }

    const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");
    const jobIds: string[] = [];

    if (mode === 'inpaint') {
      console.log(`[InpaintingProxy][${requestId}] Starting inpaint workflow.`);
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
        style_strength,
        mask_expansion_percent = 2,
        debug_assets
      } = body;
      
      console.log(`[InpaintingProxy][${requestId}] Inpaint mode received with prompt: "${prompt || 'N/A'}"`);
      console.log(`[InpaintingProxy][${requestId}] Denoise: ${denoise}`);
      console.log(`[InpaintingProxy][${requestId}] Has Reference URL: ${!!reference_image_url}`);
      console.log(`[InpaintingProxy][${requestId}] Has Reference Base64: ${!!reference_image_base64}`);
      console.log(`[InpaintingProxy][${requestId}] Has Source URL: ${!!source_image_url}`);
      console.log(`[InpaintingProxy][${requestId}] Has Source Base64: ${!!full_source_image_base64}`);
      console.log(`[InpaintingProxy][${requestId}] Has Mask URL: ${!!mask_image_url}`);
      console.log(`[InpaintingProxy][${requestId}] Has Mask Base64: ${!!mask_image_base64}`);

      if (!full_source_image_base64 && source_image_url) {
        console.log(`[InpaintingProxy][${requestId}] Source image base64 not found. Downloading from URL: ${source_image_url}`);
        const sourceBlob = await downloadFromSupabase(supabase, source_image_url);
        const sourceBuffer = await sourceBlob.arrayBuffer();
        full_source_image_base64 = encodeBase64(sourceBuffer);
        console.log(`[InpaintingProxy][${requestId}] Source image downloaded and encoded successfully.`);
      }

      if (!reference_image_base64 && reference_image_url) {
        console.log(`[InpaintingProxy][${requestId}] Reference image base64 not found. Downloading from URL: ${reference_image_url}`);
        const referenceBlob = await downloadFromSupabase(supabase, reference_image_url);
        const referenceBuffer = await referenceBlob.arrayBuffer();
        reference_image_base64 = encodeBase64(referenceBuffer);
        console.log(`[InpaintingProxy][${requestId}] Reference image downloaded and encoded successfully.`);
      }

      if (!full_source_image_base64 || (!mask_image_base64 && !mask_image_url)) {
        console.error(`[InpaintingProxy][${requestId}] Validation failed. full_source_image_base64: ${!!full_source_image_base64}, mask_image_base64: ${!!mask_image_base64}, mask_image_url: ${!!mask_image_url}`);
        throw new Error("Missing required parameters for inpaint mode: full_source_image_base64 and one of mask_image_base64 or mask_image_url are required.");
      }
      
      let maskBlob: Blob;
      if (mask_image_url) {
          console.log(`[InpaintingProxy][${requestId}] Fetching mask from URL: ${mask_image_url}`);
          maskBlob = await getMaskBlob(supabase, mask_image_url);
      } else {
          maskBlob = new Blob([decodeBase64(mask_image_base64)], { type: 'image/png' });
      }
      
      const rawMaskImage = await loadImage(new Uint8Array(await maskBlob.arrayBuffer()));
      console.log(`[InpaintingProxy][${requestId}] Mask image loaded into memory.`);

      const dilatedCanvas = createCanvas(rawMaskImage.width(), rawMaskImage.height());
      const dilateCtx = dilatedCanvas.getContext('2d');
      
      const dilationAmount = Math.max(10, Math.round(rawMaskImage.width() * (mask_expansion_percent / 100)));
      dilateCtx.filter = `blur(${dilationAmount}px)`;
      dilateCtx.drawImage(rawMaskImage, 0, 0);
      dilateCtx.filter = 'none';
      console.log(`[InpaintingProxy][${requestId}] Mask dilated by ${dilationAmount}px.`);
      
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
      console.log(`[InpaintingProxy][${requestId}] Calculated bounding box: ${JSON.stringify(bbox)}`);

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
      console.log(`[InpaintingProxy][${requestId}] Cropped source and mask to bounding box.`);

      let sourceToSendBase64 = croppedSourceBase64;
      let maskToSendBase64 = croppedDilatedMaskBase64;
      
      const TARGET_LONG_SIDE = 768;
      const cropLongestSide = Math.max(bbox.width, bbox.height);

      if (cropLongestSide < TARGET_LONG_SIDE) {
          const upscaleFactor = TARGET_LONG_SIDE / cropLongestSide;
          console.log(`[InpaintingProxy][${requestId}] Crop's longest side (${cropLongestSide}px) is below target of ${TARGET_LONG_SIDE}px. Upscaling by a factor of ${upscaleFactor.toFixed(2)}...`);
          
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
          console.log(`[InpaintingProxy][${requestId}] Upscaling complete. New crop dimensions will be approx ${Math.round(bbox.width * upscaleFactor)}x${Math.round(bbox.height * upscaleFactor)}.`);
      } else {
          console.log(`[InpaintingProxy][${requestId}] Crop's longest side (${cropLongestSide}px) is sufficient. Skipping upscale.`);
      }

      if (!prompt || prompt.trim() === "") {
        if (!reference_image_base64) {
            throw new Error("A text prompt is required when no reference image is provided.");
        }
        console.log(`[InpaintingProxy][${requestId}] No prompt provided. Auto-generating from reference...`);
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
        console.log(`[InpaintingProxy][${requestId}] Auto-prompt generated successfully.`);
      }

      if (!prompt) throw new Error("Prompt is required for inpainting.");

      for (let i = 0; i < num_attempts; i++) {
        console.log(`[InpaintingProxy][${requestId}] Starting attempt ${i + 1}/${num_attempts}.`);
        const sourceBlob = new Blob([decodeBase64(sourceToSendBase64)], { type: 'image/png' });
        const finalMaskBlob = new Blob([decodeBase64(maskToSendBase64)], { type: 'image/png' });

        const uploadPromises: Promise<{ type: string, id: string | null }>[] = [];

        console.log(`[InpaintingProxy][${requestId}] Attempt ${i + 1}: Uploading inpaint-base...`);
        uploadPromises.push(uploadImageToComfyUI(sanitizedAddress, sourceBlob, `source_${i}.png`).then(id => ({ type: 'source', id })));
        
        console.log(`[InpaintingProxy][${requestId}] Attempt ${i + 1}: Uploading inpaint-mask...`);
        uploadPromises.push(uploadImageToComfyUI(sanitizedAddress, finalMaskBlob, `mask_${i}.png`).then(id => ({ type: 'mask', id })));

        if (reference_image_base64) {
          console.log(`[InpaintingProxy][${requestId}] Attempt ${i + 1}: Uploading inpaint-reference...`);
          const referenceBlob = new Blob([decodeBase64(reference_image_base64)], { type: 'image/png' });
          uploadPromises.push(uploadImageToComfyUI(sanitizedAddress, referenceBlob, `reference_${i}.png`).then(id => ({ type: 'reference', id })));
        }

        const uploadResults = await Promise.all(uploadPromises);
        const sourceImageId = uploadResults.find(r => r.type === 'source')?.id;
        const maskImageId = uploadResults.find(r => r.type === 'mask')?.id;
        const referenceImageId = uploadResults.find(r => r.type === 'reference')?.id;

        if (!sourceImageId || !maskImageId) {
            throw new Error("Failed to upload essential source or mask images to BitStudio.");
        }
        console.log(`[InpaintingProxy][${requestId}] Attempt ${i + 1}: BitStudio Image IDs -> Source: ${sourceImageId}, Mask: ${maskImageId}, Reference: ${referenceImageId || 'N/A'}`);

        const inpaintUrl = `${sanitizedAddress}/prompt`;
        const finalWorkflow = JSON.parse(workflowTemplate);
        finalWorkflow['17'].inputs.image = sourceImageId;
        finalWorkflow['45'].inputs.image = maskImageId;
        finalWorkflow['23'].inputs.text = prompt;
        if (denoise) finalWorkflow['3'].inputs.denoise = denoise;

        if (referenceImageId) {
            finalWorkflow['52'].inputs.image = referenceImageId;
            if (style_strength) finalWorkflow['51'].inputs.strength = style_strength;
        } else {
            finalWorkflow['38'].inputs.positive = ["26", 0];
        }
        
        const inpaintPayload = { prompt: finalWorkflow };
        
        console.log(`[InpaintingProxy][${requestId}] Attempt ${i + 1}: Sending final payload to ComfyUI inpainting endpoint: ${inpaintUrl}`);
        console.log(JSON.stringify(inpaintPayload, null, 2));

        const inpaintResponse = await fetch(inpaintUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(inpaintPayload)
        });
        const responseText = await inpaintResponse.text();
        if (!inpaintResponse.ok) throw new Error(`ComfyUI inpainting request failed: ${responseText}`);
        
        const inpaintResult = JSON.parse(responseText);
        if (!inpaintResult.prompt_id) throw new Error("ComfyUI did not return a valid prompt_id for the inpainting job.");
        console.log(`[InpaintingProxy][${requestId}] Attempt ${i + 1}: Inpainting job queued with ComfyUI. Prompt ID: ${inpaintResult.prompt_id}`);
        
        const sourceImageUrl = await uploadToSupabaseStorage(supabase, new Blob([decodeBase64(full_source_image_base64)], { type: 'image/png' }), user_id, 'full_source.png');
        let referenceImageUrlForDb: string | null = null;
        if (reference_image_base64) {
            referenceImageUrlForDb = await uploadToSupabaseStorage(supabase, new Blob([decodeBase64(reference_image_base64)], { type: 'image/png' }), user_id, 'reference.png');
        }

        const metadataToSave = {
          prompt_used: prompt, 
          denoise, 
          style_strength,
          source_image_url: sourceImageUrl,
          reference_image_url: referenceImageUrlForDb,
          full_source_image_base64,
          bbox,
          cropped_dilated_mask_base64,
          debug_assets: debug_assets || {}
        };

        const { data: newJob, error: insertError } = await supabase.from('mira-agent-inpainting-jobs').insert({
          user_id,
          comfyui_address: sanitizedAddress,
          comfyui_prompt_id: inpaintResult.prompt_id,
          status: 'queued',
          metadata: metadataToSave,
        }).select('id').single();
        if (insertError) throw insertError;
        jobIds.push(newJob.id);
        console.log(`[InpaintingProxy][${requestId}] Attempt ${i + 1}: Job record created in DB with ID: ${newJob.id}`);
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
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` },
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
      const pollerName = mode === 'inpaint' ? 'MIRA-AGENT-poller-inpainting' : 'MIRA-AGENT-poller-bitstudio';
      supabase.functions.invoke(pollerName, { body: { job_id: jobId } }).catch(console.error);
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