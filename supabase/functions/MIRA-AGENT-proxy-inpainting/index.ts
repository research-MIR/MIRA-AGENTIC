import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UPLOAD_BUCKET = 'mira-agent-user-uploads';

async function uploadToBitStudio(fileBlob: Blob, type: 'inpaint-base' | 'inpaint-mask' | 'inpaint-reference', filename: string): Promise<string> {
  const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
  const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';
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

serve(async (req) => {
  const requestId = `inpainting-proxy-${Date.now()}`;
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const {
      user_id,
      source_image_base64,
      mask_image_base64,
      reference_image_base64,
      prompt,
      denoise,
      is_high_quality,
      mask_expansion_percent,
      num_attempts = 1,
    } = await req.json();

    if (!user_id || !source_image_base64 || !mask_image_base64) {
      throw new Error("Missing required parameters: user_id, source_image_base64, and mask_image_base64 are required.");
    }

    const { createCanvas, loadImage } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
    
    let fullSourceImage = await loadImage(`data:image/png;base64,${source_image_base64}`);
    const MAX_LONG_SIDE = 3000;
    const longestSide = Math.max(fullSourceImage.width(), fullSourceImage.height());

    if (longestSide > MAX_LONG_SIDE) {
      const scaleFactor = MAX_LONG_SIDE / longestSide;
      const newWidth = Math.round(fullSourceImage.width() * scaleFactor);
      const newHeight = Math.round(fullSourceImage.height() * scaleFactor);
      const resizeCanvas = createCanvas(newWidth, newHeight);
      const resizeCtx = resizeCanvas.getContext('2d');
      resizeCtx.drawImage(fullSourceImage, 0, 0, newWidth, newHeight);
      const resizedBase64 = resizeCanvas.toDataURL().split(',')[1];
      fullSourceImage = await loadImage(`data:image/png;base64,${resizedBase64}`);
    }

    const rawMaskImage = await loadImage(`data:image/jpeg;base64,${mask_image_base64}`);
    const dilatedCanvas = createCanvas(rawMaskImage.width(), rawMaskImage.height());
    const dilateCtx = dilatedCanvas.getContext('2d');
    const dilationAmount = Math.max(10, Math.round(rawMaskImage.width() * (mask_expansion_percent / 100)));
    dilateCtx.filter = `blur(${dilationAmount}px)`;
    dilateCtx.drawImage(rawMaskImage, 0, 0);
    dilateCtx.filter = 'none';
    
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

    if (maxX < minX || maxY < minY) throw new Error("The provided mask is empty or invalid.");

    const padding = Math.round(Math.max(maxX - minX, maxY - minY) * 0.05);
    const x1 = Math.max(0, minX - padding);
    const y1 = Math.max(0, minY - padding);
    const x2 = Math.min(fullSourceImage.width(), maxX + padding);
    const y2 = Math.min(fullSourceImage.height(), maxY + padding);
    const width = x2 - x1;
    const height = y2 - y1;
    if (width <= 0 || height <= 0) throw new Error(`Invalid bounding box dimensions: ${width}x${height}.`);
    const bbox = { x: x1, y: y1, width, height };

    const croppedCanvas = createCanvas(bbox.width, bbox.height);
    const cropCtx = croppedCanvas.getContext('2d');
    cropCtx.drawImage(fullSourceImage, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
    const croppedSourceBase64 = croppedCanvas.toDataURL().split(',')[1];

    const croppedMaskCanvas = createCanvas(bbox.width, bbox.height);
    const cropMaskCtx = croppedMaskCanvas.getContext('2d');
    cropMaskCtx.drawImage(dilatedCanvas, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
    const croppedDilatedMaskBase64 = croppedMaskCanvas.toDataURL().split(',')[1];

    let sourceToSendBase64 = croppedSourceBase64;
    let maskToSendBase64 = croppedDilatedMaskBase64;
    
    const TARGET_LONG_SIDE = 768;
    const cropLongestSide = Math.max(bbox.width, bbox.height);
    if (cropLongestSide < TARGET_LONG_SIDE) {
        const upscaleFactor = TARGET_LONG_SIDE / cropLongestSide;
        const { data: upscaleData, error: upscaleError } = await supabase.functions.invoke('MIRA-AGENT-tool-upscale-crop', {
            body: { source_crop_base64: croppedSourceBase64, mask_crop_base64: croppedDilatedMaskBase64, upscale_factor: upscaleFactor }
        });
        if (upscaleError) throw new Error(`Upscaling failed: ${upscaleError.message}`);
        sourceToSendBase64 = upscaleData.upscaled_source_base64;
        maskToSendBase64 = upscaleData.upscaled_mask_base64;
    }

    let finalPrompt = prompt;
    if (!finalPrompt || finalPrompt.trim() === "") {
        const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
          body: { 
            person_image_base64: sourceToSendBase64, 
            person_image_mime_type: 'image/png',
            garment_image_base64: reference_image_base64,
            garment_image_mime_type: 'image/png',
            is_garment_mode: false
          }
        });
        if (promptError) throw new Error(`Auto-prompt generation failed: ${promptError.message}`);
        finalPrompt = promptData.final_prompt;
    }

    if (!finalPrompt) throw new Error("Prompt is required for inpainting.");

    const jobIds: string[] = [];
    for (let i = 0; i < num_attempts; i++) {
      const sourceBlob = new Blob([decodeBase64(sourceToSendBase64)], { type: 'image/png' });
      const maskBlob = new Blob([decodeBase64(maskToSendBase64)], { type: 'image/png' });

      const uploadPromises: Promise<string | null>[] = [
        uploadToBitStudio(sourceBlob, 'inpaint-base', `source_${i}.png`),
        uploadToBitStudio(maskBlob, 'inpaint-mask', `mask_${i}.png`)
      ];
      if (reference_image_base64) {
        const referenceBlob = new Blob([decodeBase64(reference_image_base64)], { type: 'image/png' });
        uploadPromises.push(uploadToBitStudio(referenceBlob, 'inpaint-reference', `reference_${i}.png`));
      } else {
        uploadPromises.push(Promise.resolve(null));
      }
      const [sourceImageId, maskImageId, referenceImageId] = await Promise.all(uploadPromises);

      const inpaintUrl = `${Deno.env.get('BITSTUDIO_API_BASE')}/images/${sourceImageId}/inpaint`;
      const inpaintPayload: any = { 
          mask_image_id: maskImageId, 
          prompt: finalPrompt, 
          resolution: is_high_quality ? 'high' : 'standard', 
          denoise,
          seed: Math.floor(Math.random() * 1000000000)
      };
      if (referenceImageId) inpaintPayload.reference_image_id = referenceImageId;
      
      const inpaintResponse = await fetch(inpaintUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${Deno.env.get('BITSTUDIO_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(inpaintPayload)
      });
      const responseText = await inpaintResponse.text();
      if (!inpaintResponse.ok) throw new Error(`BitStudio inpainting request failed: ${responseText}`);
      
      const inpaintResult = JSON.parse(responseText);
      const newVersion = inpaintResult.versions?.[0];
      if (!newVersion || !newVersion.id) throw new Error("BitStudio did not return a valid version object.");
      
      const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
        user_id, mode: 'inpaint', status: 'queued', bitstudio_task_id: inpaintResult.id,
        metadata: {
          bitstudio_version_id: newVersion.id,
          full_source_image_base64: source_image_base64,
          cropped_source_image_base64: croppedSourceBase64,
          cropped_dilated_mask_base64: croppedDilatedMaskBase64,
          bbox,
          prompt_used: finalPrompt,
        }
      }).select('id').single();
      if (insertError) throw insertError;
      jobIds.push(newJob.id);
    }

    jobIds.forEach(jobId => {
      supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id: jobId } }).catch(console.error);
    });

    return new Response(JSON.stringify({ success: true, jobIds }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[InpaintingProxy][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});