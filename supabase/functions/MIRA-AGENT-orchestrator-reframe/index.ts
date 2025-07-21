import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { GoogleAuth } from "npm:google-auth-library";
import { encodeBase64, decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const GOOGLE_VERTEX_AI_SA_KEY_JSON = Deno.env.get('GOOGLE_VERTEX_AI_SA_KEY_JSON');
const GOOGLE_PROJECT_ID = Deno.env.get('GOOGLE_PROJECT_ID');
const GOOGLE_LOCATION = 'us-central1';
const MODEL_ID = 'imagen-3.0-capability-001';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");
  
  const logPrefix = `[ReframeOrchestrator][${job_id}]`;

  try {
    console.log(`${logPrefix} Starting orchestration.`);
    await supabase.from('mira-agent-jobs').update({ status: 'processing' }).eq('id', job_id);
    
    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('context, user_id').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const { context } = job;
    let finalBaseImageB64: string;
    let finalMaskImageB64: string;

    if (!context.mask_image_url) {
      console.log(`${logPrefix} No pre-made mask found. Generating new canvas and mask.`);
      const { base_image_url, aspect_ratio } = context;
      if (!base_image_url || !aspect_ratio) throw new Error("Missing base_image_url or aspect_ratio for mask generation.");

      const url = new URL(base_image_url);
      const pathPrefix = `/storage/v1/object/public/${UPLOAD_BUCKET}/`;
      const imagePath = decodeURIComponent(url.pathname.substring(pathPrefix.length));
      const { data: blob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(imagePath);
      if (downloadError) throw new Error(`Failed to download base image: ${downloadError.message}`);

      const originalImage = await loadImage(new Uint8Array(await blob.arrayBuffer()));
      const originalW = originalImage.width();
      const originalH = originalImage.height();

      const [targetW, targetH] = aspect_ratio.split(':').map(Number);
      const targetRatio = targetW / targetH;
      const originalRatio = originalW / originalH;

      let newW, newH;
      if (targetRatio > originalRatio) {
        newW = Math.round(originalH * targetRatio);
        newH = originalH;
      } else {
        newH = Math.round(originalW / targetRatio);
        newW = originalW;
      }

      const xOffset = (newW - originalW) / 2;
      const yOffset = (newH - originalH) / 2;

      const maskCanvas = createCanvas(newW, newH);
      const maskCtx = maskCanvas.getContext('2d');
      maskCtx.fillStyle = 'white';
      maskCtx.fillRect(0, 0, newW, newH);
      const featherAmount = Math.min(Math.max(2, Math.round(Math.min(originalW, originalH) * 0.005)), 48);
      maskCtx.fillStyle = 'black';
      maskCtx.shadowColor = 'black';
      maskCtx.shadowBlur = featherAmount;
      maskCtx.fillRect(xOffset, yOffset, originalW, originalH);
      finalMaskImageB64 = encodeBase64(maskCanvas.toBuffer('image/png', 0));

      const newBaseCanvas = createCanvas(newW, newH);
      const newBaseCtx = newBaseCanvas.getContext('2d');
      newBaseCtx.fillStyle = 'white';
      newBaseCtx.fillRect(0, 0, newW, newH);
      newBaseCtx.drawImage(originalImage, xOffset, yOffset);
      finalBaseImageB64 = encodeBase64(newBaseCanvas.toBuffer('image/jpeg', 95));
      console.log(`${logPrefix} Generated new assets in memory.`);
    } else {
      console.log(`${logPrefix} Pre-made mask found. Downloading assets.`);
      const [baseBlob, maskBlob] = await Promise.all([
        downloadImageAsBlob(supabase, context.base_image_url),
        downloadImageAsBlob(supabase, context.mask_image_url)
      ]);
      [finalBaseImageB64, finalMaskImageB64] = await Promise.all([
        blobToBase64(baseBlob),
        blobToBase64(maskBlob)
      ]);
    }

    console.log(`${logPrefix} Calling Google Vertex AI...`);
    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_VERTEX_AI_SA_KEY_JSON!),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const accessToken = await auth.getAccessToken();
    const apiUrl = `https://${GOOGLE_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${GOOGLE_LOCATION}/publishers/google/models/${MODEL_ID}:predict`;

    const requestBody = {
      instances: [{
        prompt: context.prompt || "A high quality photorealistic image.",
        referenceImages: [
          { referenceType: "REFERENCE_TYPE_RAW", referenceId: 1, referenceImage: { bytesBase64Encoded: finalBaseImageB64 } },
          { referenceType: "REFERENCE_TYPE_MASK", referenceId: 2, referenceImage: { bytesBase64Encoded: finalMaskImageB64 }, maskImageConfig: { maskMode: "MASK_MODE_USER_PROVIDED", dilation: context.dilation || 0.03 } }
        ]
      }],
      parameters: {
        editConfig: { baseSteps: context.steps || 35 },
        editMode: "EDIT_MODE_OUTPAINT",
        sampleCount: context.count || 1,
        outputOptions: { mimeType: "image/png" }
      }
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API call failed with status ${response.status}: ${errorBody}`);
    }

    const responseData = await response.json();
    const predictions = responseData.predictions;
    if (!predictions || !Array.isArray(predictions) || predictions.length === 0) {
      throw new Error("API response did not contain valid image predictions.");
    }

    const uploadPromises = predictions.map(async (prediction: any, index: number) => {
      const imageBuffer = decodeBase64(prediction.bytesBase64Encoded);
      const filePath = `${job.user_id}/reframe/${Date.now()}_${index}.png`;
      await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
      const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
      return { publicUrl, storagePath: filePath };
    });

    const finalImages = await Promise.all(uploadPromises);
    console.log(`${logPrefix} Uploaded ${finalImages.length} images to storage.`);

    await supabase.from('mira-agent-jobs').update({
      status: 'complete',
      final_result: { images: finalImages }
    }).eq('id', job_id);

    const parentVtoJobId = context.parent_recontext_job_id;
    if (parentVtoJobId) {
      console.log(`${logPrefix} This was a VTO job. Reporting back to parent worker ${parentVtoJobId}...`);
      const finalImageUrl = finalImages[0]?.publicUrl;
      if (finalImageUrl) {
        await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
          body: { pair_job_id: parentVtoJobId, reframe_result_url: finalImageUrl }
        });
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});