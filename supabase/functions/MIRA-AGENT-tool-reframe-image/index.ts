import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleAuth } from "npm:google-auth-library";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_VERTEX_AI_SA_KEY_JSON = Deno.env.get('GOOGLE_VERTEX_AI_SA_KEY_JSON');
const GOOGLE_PROJECT_ID = Deno.env.get('GOOGLE_PROJECT_ID');
const GOOGLE_LOCATION = 'us-central1';
const MODEL_ID = 'imagen-3.0-capability-001';
const GENERATED_IMAGES_BUCKET = 'mira-generations';

async function downloadImageAsBlob(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/');
    
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download image from storage: ${error.message}`);
    return data;
}

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }

  const { job_id, prompt: providedPrompt, dilation, steps } = await req.json();
  if (!job_id) throw new Error("job_id is required.");

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const logPrefix = `[ReframeWorker][${job_id}]`;

  try {
    console.log(`${logPrefix} Starting job.`);
    await supabase.from('mira-agent-jobs').update({ status: 'processing' }).eq('id', job_id);

    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('context, user_id').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const { base_image_url, mask_image_url, count, invert_mask } = job.context;
    const prompt = providedPrompt || job.context.prompt || "";
    if (!base_image_url || !mask_image_url) throw new Error("Missing image URLs in job context.");

    console.log(`${logPrefix} Downloading images...`);
    const [baseImageBlob, maskImageBlob] = await Promise.all([
        downloadImageAsBlob(supabase, base_image_url),
        downloadImageAsBlob(supabase, mask_image_url)
    ]);

    const baseImage = await loadImage(new Uint8Array(await baseImageBlob.arrayBuffer()));
    const maskImage = await loadImage(new Uint8Array(await maskImageBlob.arrayBuffer()));

    let finalBaseImageB64: string;
    let finalMaskImageB64: string;

    if (baseImage.width() !== maskImage.width() || baseImage.height() !== maskImage.height()) {
        console.log(`${logPrefix} Dimension mismatch detected. Creating new canvas.`);
        const newCanvas = createCanvas(maskImage.width(), maskImage.height());
        const ctx = newCanvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, newCanvas.width, newCanvas.height);
        const x = (newCanvas.width - baseImage.width()) / 2;
        const y = (newCanvas.height - baseImage.height()) / 2;
        ctx.drawImage(baseImage, x, y);
        finalBaseImageB64 = newCanvas.toDataURL('image/png').split(',')[1];
    } else {
        finalBaseImageB64 = await blobToBase64(baseImageBlob);
    }

    if (invert_mask) {
        console.log(`${logPrefix} Inverting mask as requested.`);
        const maskCanvas = createCanvas(maskImage.width(), maskImage.height());
        const ctx = maskCanvas.getContext('2d');
        ctx.drawImage(maskImage, 0, 0);
        const imageData = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = 255 - data[i];
            data[i + 1] = 255 - data[i + 1];
            data[i + 2] = 255 - data[i + 2];
        }
        ctx.putImageData(imageData, 0, 0);
        finalMaskImageB64 = maskCanvas.toDataURL('image/png').split(',')[1];
    } else {
        finalMaskImageB64 = await blobToBase64(maskImageBlob);
    }

    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_VERTEX_AI_SA_KEY_JSON!),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const accessToken = await auth.getAccessToken();
    const apiUrl = `https://${GOOGLE_LOCATION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${GOOGLE_LOCATION}/publishers/google/models/${MODEL_ID}:predict`;

    const requestBody = {
      instances: [{
        prompt: prompt,
        referenceImages: [
          { referenceType: "REFERENCE_TYPE_RAW", referenceId: 1, referenceImage: { bytesBase64Encoded: finalBaseImageB64 } },
          { referenceType: "REFERENCE_TYPE_MASK", referenceId: 2, referenceImage: { bytesBase64Encoded: finalMaskImageB64 }, maskImageConfig: { maskMode: "MASK_MODE_USER_PROVIDED", dilation: dilation || 0.03 } }
        ]
      }],
      parameters: {
        editConfig: { baseSteps: steps || 35 },
        editMode: "EDIT_MODE_OUTPAINT",
        sampleCount: count || 1
      }
    };

    console.log(`${logPrefix} Calling Google Vertex AI...`);
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
    console.log(`${logPrefix} Received ${predictions.length} predictions.`);

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

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});