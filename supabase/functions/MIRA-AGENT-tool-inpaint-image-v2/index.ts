import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const POLLING_INTERVAL_MS = 2000; // 2 seconds
const MAX_POLLING_ATTEMPTS = 30; // 1 minute timeout

type BitStudioImageType = 'inpaint-base' | 'inpaint-mask' | 'inpaint-reference';

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

async function pollForInpaintingResult(baseImageId: string, versionId: string): Promise<string> {
    for (let i = 0; i < MAX_POLLING_ATTEMPTS; i++) {
        await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS));
        
        const statusUrl = `${BITSTUDIO_API_BASE}/images/${baseImageId}`;
        const statusResponse = await fetch(statusUrl, {
            headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` }
        });

        if (!statusResponse.ok) continue; // Ignore transient errors and retry

        const statusData = await statusResponse.json();
        const targetVersion = statusData.versions?.find((v: any) => v.id === versionId);

        if (targetVersion) {
            if (targetVersion.status === 'completed') {
                return targetVersion.path;
            }
            if (targetVersion.status === 'failed') {
                throw new Error("BitStudio inpainting job failed.");
            }
        }
    }
    throw new Error("Inpainting job timed out.");
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
        full_source_image_base64, 
        cropped_source_image_base64, 
        cropped_dilated_mask_base64, 
        prompt, 
        bbox,
        user_id 
    } = await req.json();

    if (!full_source_image_base64 || !cropped_source_image_base64 || !cropped_dilated_mask_base64 || !prompt || !bbox || !user_id) {
      throw new Error("Missing one or more required parameters.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const croppedSourceBlob = new Blob([decodeBase64(cropped_source_image_base64)], { type: 'image/png' });
    const croppedDilatedMaskBlob = new Blob([decodeBase64(cropped_dilated_mask_base64)], { type: 'image/png' });

    const [croppedSourceImageId, dilatedMaskImageId] = await Promise.all([
        uploadToBitStudio(croppedSourceBlob, 'inpaint-base', 'cropped_source.png'),
        uploadToBitStudio(croppedDilatedMaskBlob, 'inpaint-mask', 'cropped_dilated_mask.png')
    ]);

    const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${croppedSourceImageId}/inpaint`;
    const inpaintPayload = { mask_image_id: dilatedMaskImageId, prompt, resolution: 'standard', denoise: 1.0 };
    
    const inpaintResponse = await fetch(inpaintUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(inpaintPayload)
    });

    if (!inpaintResponse.ok) throw new Error(`BitStudio inpainting request failed: ${await inpaintResponse.text()}`);
    
    const inpaintResult = await inpaintResponse.json();
    const newVersion = inpaintResult.versions?.[0];
    if (!newVersion || !newVersion.id) throw new Error("BitStudio did not return a valid version object for the inpainting job.");
    
    const inpaintedCropUrl = await pollForInpaintingResult(inpaintResult.id, newVersion.id);

    const { createCanvas, loadImage } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
    
    const fullSourceImage = await loadImage(`data:image/png;base64,${full_source_image_base64}`);
    const inpaintedCropResponse = await fetch(inpaintedCropUrl);
    if (!inpaintedCropResponse.ok) throw new Error("Failed to download inpainted crop from BitStudio.");
    const inpaintedCropImage = await loadImage(await inpaintedCropResponse.arrayBuffer());

    const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
    const ctx = canvas.getContext('2d');

    ctx.drawImage(fullSourceImage, 0, 0);
    ctx.drawImage(inpaintedCropImage, bbox.x, bbox.y, bbox.width, bbox.height);

    const finalImageBuffer = canvas.toBuffer('image/png');
    
    const filePath = `${user_id}/inpainted/${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, finalImageBuffer, { contentType: 'image/png', upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

    return new Response(JSON.stringify({ success: true, imageUrl: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[InpaintToolV2] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});