import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
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
    const pathStartIndex = url.pathname.indexOf(UPLOAD_BUCKET) + UPLOAD_BUCKET.length + 1;
    const filePath = decodeURIComponent(url.pathname.substring(pathStartIndex));

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

serve(async (req) => {
  const requestId = `proxy-${Date.now()}`;
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const body = await req.json();
    const { user_id, mode } = body;
    if (!user_id || !mode) {
      throw new Error("user_id and mode are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const jobIds: string[] = [];

    if (mode === 'inpaint') {
      let { 
        full_source_image_base64, mask_image_base64, prompt, reference_image_base64, 
        auto_prompt_enabled, num_attempts = 1, denoise = 1.0, resolution = 'standard', mask_expansion_percent = 2 
      } = body;
      
      if (!full_source_image_base64 || !mask_image_base64) {
        throw new Error("Missing required parameters for inpaint mode: full_source_image_base64 and mask_image_base64 are required.");
      }

      const { createCanvas, loadImage } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
      
      const fullSourceImage = await loadImage(`data:image/png;base64,${full_source_image_base64}`);
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

      if (maxX < minX) throw new Error("The provided mask is empty.");

      const padding = Math.round(Math.max(maxX - minX, maxY - minY) * 0.05);
      const bbox = {
        x: Math.max(0, minX - padding),
        y: Math.max(0, minY - padding),
        width: Math.min(fullSourceImage.width() - (minX - padding), (maxX - minX) + padding * 2),
        height: Math.min(fullSourceImage.height() - (minY - padding), (maxY - minY) + padding * 2)
      };

      const croppedCanvas = createCanvas(bbox.width, bbox.height);
      const cropCtx = croppedCanvas.getContext('2d');
      cropCtx.drawImage(fullSourceImage, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
      const croppedSourceBase64 = croppedCanvas.toBuffer('image/png').toString('base64');

      const croppedMaskCanvas = createCanvas(bbox.width, bbox.height);
      const cropMaskCtx = croppedMaskCanvas.getContext('2d');
      cropMaskCtx.drawImage(dilatedCanvas, bbox.x, bbox.y, bbox.width, bbox.height, 0, 0, bbox.width, bbox.height);
      const croppedDilatedMaskBase64 = croppedMaskCanvas.toBuffer('image/jpeg').toString('base64');

      if (auto_prompt_enabled) {
        const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-prompt-helper', {
          body: { 
            person_image_base64: croppedSourceBase64, 
            person_image_mime_type: 'image/png',
            garment_image_base64: reference_image_base64,
            garment_image_mime_type: 'image/png'
          }
        });
        if (promptError) throw new Error(`Auto-prompt generation failed: ${promptError.message}`);
        prompt = promptData.final_prompt;
      }

      if (!prompt) throw new Error("Prompt is required for inpainting.");

      for (let i = 0; i < num_attempts; i++) {
        const sourceBlob = new Blob([decodeBase64(croppedSourceBase64)], { type: 'image/png' });
        const maskBlob = new Blob([decodeBase64(croppedDilatedMaskBase64)], { type: 'image/jpeg' });

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

        const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${sourceImageId}/inpaint`;
        const inpaintPayload: any = { mask_image_id: maskImageId, prompt, resolution, denoise };
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
        
        const metadataToSave = {
          bitstudio_version_id: newVersion.id,
          full_source_image_base64,
          cropped_source_image_base64,
          cropped_dilated_mask_base64,
          bbox,
          prompt_used: prompt,
        };

        const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
          user_id, mode, status: 'queued', bitstudio_task_id: inpaintResult.id,
          metadata: metadataToSave
        }).select('id').single();
        if (insertError) throw insertError;
        jobIds.push(newJob.id);
      }

    } else { // Default to virtual-try-on
      const { person_image_url, garment_image_url, resolution, num_images, prompt } = body;
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
        resolution: resolution || "standard",
        num_images: num_images || 1,
      };
      if (prompt) vtoPayload.prompt = prompt;

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