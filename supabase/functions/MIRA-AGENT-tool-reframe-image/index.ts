import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleAuth } from "npm:google-auth-library";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_VERTEX_AI_SA_KEY_JSON = Deno.env.get('GOOGLE_VERTEX_AI_SA_KEY_JSON');
const GOOGLE_PROJECT_ID = Deno.env.get('GOOGLE_PROJECT_ID');
const GOOGLE_LOCATION = 'us-central1';
const MODEL_ID = 'imagen-3.0-capability-001';
const GENERATED_IMAGES_BUCKET = 'mira-generations';

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

async function downloadImageAsBlob(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
    
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download image from storage: ${error.message}`);
    return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const logPrefix = `[ReframeWorker][${job_id}]`;

  try {
    console.log(`${logPrefix} Starting job.`);
    await supabase.from('mira-agent-jobs').update({ status: 'processing' }).eq('id', job_id);

    console.log(`${logPrefix} Fetching job details from database...`);
    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('context, user_id').eq('id', job_id).single();
    if (fetchError) throw fetchError;
    console.log(`${logPrefix} Job details fetched successfully.`);

    const { context } = job;
    const { base_image_url, mask_image_url, prompt, dilation, steps, count, invert_mask } = context;
    if (!base_image_url || !mask_image_url) throw new Error("Missing image URLs in job context.");
    console.log(`${logPrefix} Base URL: ${base_image_url}`);
    console.log(`${logPrefix} Mask URL: ${mask_image_url}`);

    console.log(`${logPrefix} Downloading images...`);
    const [baseImageBlob, maskImageBlob] = await Promise.all([
        downloadImageAsBlob(supabase, base_image_url),
        downloadImageAsBlob(supabase, mask_image_url)
    ]);
    console.log(`${logPrefix} Images downloaded. Base size: ${baseImageBlob.size}, Mask size: ${maskImageBlob.size}`);
    if (baseImageBlob.size === 0) {
        throw new Error("Downloaded base image is empty (0 bytes). Cannot proceed.");
    }

    const [finalBaseImageB64, finalMaskImageB64] = await Promise.all([
        blobToBase64(baseImageBlob),
        blobToBase64(maskImageBlob)
    ]);
    console.log(`${logPrefix} Images converted to Base64. Base length: ${finalBaseImageB64.length}, Mask length: ${finalMaskImageB64.length}`);
    if (finalBaseImageB64.length === 0) {
        throw new Error("Converted base image is empty (0 length base64 string). Cannot proceed.");
    }

    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_VERTEX_AI_SA_KEY_JSON!),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const accessToken = await auth.getAccessToken();
    const apiUrl = `https://${GOOGLE_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${GOOGLE_LOCATION}/publishers/google/models/${MODEL_ID}:predict`;

    const requestBody = {
      instances: [{
        prompt: prompt || "A high quality photorealistic image.",
        referenceImages: [
          { referenceType: "REFERENCE_TYPE_RAW", referenceId: 1, referenceImage: { bytesBase64Encoded: finalBaseImageB64 } },
          { referenceType: "REFERENCE_TYPE_MASK", referenceId: 2, referenceImage: { bytesBase64Encoded: finalMaskImageB64 }, maskImageConfig: { maskMode: "MASK_MODE_USER_PROVIDED", dilation: dilation || 0.03 } }
        ]
      }],
      parameters: {
        editConfig: { baseSteps: steps || 35 },
        editMode: "EDIT_MODE_OUTPAINT",
        sampleCount: count || 1,
        outputOptions: {
            mimeType: "image/png"
        }
      }
    };
    
    const sanitizedPayload = JSON.parse(JSON.stringify(requestBody));
    sanitizedPayload.instances[0].referenceImages[0].referenceImage.bytesBase64Encoded = `[BASE64_DATA_REDACTED_LENGTH_${finalBaseImageB64.length}]`;
    sanitizedPayload.instances[0].referenceImages[1].referenceImage.bytesBase64Encoded = `[BASE64_DATA_REDACTED_LENGTH_${finalMaskImageB64.length}]`;

    console.log(`${logPrefix} Calling Google Vertex AI with sanitized payload:`, JSON.stringify(sanitizedPayload, null, 2));
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(requestBody)
    });

    console.log(`${logPrefix} Google Vertex AI response status: ${response.status}`);
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`${logPrefix} Google API Error Body:`, errorBody);
      throw new Error(`API call failed with status ${response.status}: ${errorBody}`);
    }

    const responseData = await response.json();
    const predictions = responseData.predictions;
    if (!predictions || !Array.isArray(predictions) || predictions.length === 0) {
      console.error(`${logPrefix} Invalid API response:`, JSON.stringify(responseData, null, 2));
      throw new Error("API response did not contain valid image predictions.");
    }
    console.log(`${logPrefix} Received ${predictions.length} predictions.`);

    const uploadPromises = predictions.map(async (prediction: any, index: number) => {
      const imageBuffer = decodeBase64(prediction.bytesBase64Encoded);
      const filePath = `${job.user_id}/reframe/${Date.now()}_${index}.png`;
      console.log(`${logPrefix} Uploading result ${index + 1} to ${filePath}...`);
      await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: 'image/png', upsert: true });
      const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
      return { publicUrl, storagePath: filePath };
    });

    const finalImages = await Promise.all(uploadPromises);
    console.log(`${logPrefix} Uploaded ${finalImages.length} images to storage.`);

    console.log(`${logPrefix} Updating job status to 'complete'.`);
    await supabase.from('mira-agent-jobs').update({
      status: 'complete',
      final_result: { images: finalImages }
    }).eq('id', job_id);
    console.log(`${logPrefix} Job finalized successfully.`);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix} FATAL ERROR:`, error);
    await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', job_id);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});