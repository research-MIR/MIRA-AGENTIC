import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleAuth } from "npm:google-auth-library";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const GOOGLE_VERTEX_AI_SA_KEY_JSON = Deno.env.get('GOOGLE_VERTEX_AI_SA_KEY_JSON');
const GOOGLE_PROJECT_ID = Deno.env.get('GOOGLE_PROJECT_ID');
const REGION = 'us-central1';
const MODEL_ID = 'virtual-try-on-exp-05-31';
const MAX_RETRIES = 6;
const RETRY_DELAY_MS = 50000;

// --- DIAGNOSTIC: Global Error Handlers ---
self.addEventListener('unhandledrejection', (event)=>{
  console.error(`[GLOBAL UNHANDLED REJECTION] Reason:`, event.reason);
});
self.addEventListener('error', (event)=>{
  console.error(`[GLOBAL ERROR] Message: ${event.message}, Filename: ${event.filename}, Lineno: ${event.lineno}, Error:`, event.error);
});
// --- END DIAGNOSTIC ---

const fetchWithRetry = async (url, options, maxRetries = 3, delay = 15000, requestId)=>{
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      console.warn(`[FetchRetry][${requestId}] Attempt ${attempt}/${maxRetries} failed for ${url}. Status: ${response.status}.`);
      if (attempt === maxRetries) {
        throw new Error(`API call failed with status ${response.status} after ${maxRetries} attempts: ${await response.text()}`);
      }
    } catch (error) {
      console.warn(`[FetchRetry][${requestId}] Attempt ${attempt}/${maxRetries} failed for ${url} with network error: ${error.message}`);
      if (attempt === maxRetries) {
        throw new Error(`Network request failed after ${maxRetries} attempts: ${error.message}`);
      }
    }
    await new Promise((resolve)=>setTimeout(resolve, delay * attempt)); // Linear backoff
  }
  throw new Error("Fetch with retry failed unexpectedly.");
};

const blobToBase64 = async (blob)=>{
  const buffer = await blob.arrayBuffer();
  return encodeBase64(new Uint8Array(buffer));
};

async function downloadImage(supabase, url, requestId) {
  console.log(`[Downloader][${requestId}] Attempting to download from URL: ${url}`);
  if (url.includes('supabase.co')) {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
      throw new Error(`[Downloader][${requestId}] Could not parse bucket name from Supabase URL: ${url}`);
    }
    const bucketName = pathSegments[objectSegmentIndex + 2];
    const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    if (!bucketName || !filePath) {
      throw new Error(`[Downloader][${requestId}] Could not parse bucket or path from Supabase URL: ${url}`);
    }
    console.log(`[Downloader][${requestId}] Parsed Supabase path. Bucket: ${bucketName}, Path: ${filePath}`);
    const { data: blob, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) {
      throw new Error(`[Downloader][${requestId}] Failed to download from Supabase storage (${filePath}): ${error.message}`);
    }
    console.log(`[Downloader][${requestId}] Supabase download successful. Blob size: ${blob.size}`);
    return blob;
  } else {
    console.log(`[Downloader][${requestId}] URL is not from Supabase. Fetching directly.`);
    const response = await fetchWithRetry(url, {}, 3, 1500, requestId);
    const blob = await response.blob();
    console.log(`[Downloader][${requestId}] External URL download successful. Blob size: ${blob.size}`);
    return blob;
  }
}

serve(async (req)=>{
  const requestId = `vto-tool-${Date.now()}`;
  console.log(`[VirtualTryOnTool][${requestId}] Function invoked. Running version 2.1 with safety filter retry.`);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

  try {
    if (!GOOGLE_VERTEX_AI_SA_KEY_JSON || !GOOGLE_PROJECT_ID) {
      throw new Error("Server configuration error: Missing Google Cloud credentials.");
    }

    const body = await req.json();
    console.log(`[VirtualTryOnTool][${requestId}] Request body successfully parsed. Keys found: ${Object.keys(body).join(', ')}`);

    const { person_image_url, garment_image_url, person_image_base64: person_b64_input, garment_image_base64: garment_b64_input, sample_step, sample_count = 1 } = body;

    let person_image_base64;
    let garment_image_base64;

    if (person_b64_input) {
      person_image_base64 = person_b64_input;
    } else if (person_image_url) {
      console.log(`[VirtualTryOnTool][${requestId}] Downloading person image from URL: ${person_image_url}`);
      const personBlob = await downloadImage(supabase, person_image_url, requestId);
      person_image_base64 = await blobToBase64(personBlob);
      console.log(`[VirtualTryOnTool][${requestId}] Person image processed. Base64 length: ${person_image_base64.length}`);
    } else {
      throw new Error("Either person_image_url or person_image_base64 is required.");
    }

    if (garment_b64_input) {
      garment_image_base64 = garment_b64_input;
    } else if (garment_image_url) {
      console.log(`[VirtualTryOnTool][${requestId}] Downloading garment image from URL: ${garment_image_url}`);
      const garmentBlob = await downloadImage(supabase, garment_image_url, requestId);
      garment_image_base64 = await blobToBase64(garmentBlob);
      console.log(`[VirtualTryOnTool][${requestId}] Garment image processed. Base64 length: ${garment_image_base64.length}`);
    } else {
      throw new Error("Either garment_image_url or garment_image_base64 is required.");
    }

    console.log(`[VirtualTryOnTool][${requestId}] Images processed. Authenticating with Google...`);
    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_VERTEX_AI_SA_KEY_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const accessToken = await auth.getAccessToken();
    console.log(`[VirtualTryOnTool][${requestId}] Google authentication successful.`);

    const apiUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}:predict`;

    const requestBody = {
      instances: [
        {
          personImage: { image: { bytesBase64Encoded: person_image_base64 } },
          productImages: [ { image: { bytesBase64Encoded: garment_image_base64 } } ]
        }
      ],
      parameters: {
        sampleCount: sample_count,
        addWatermark: false,
        safetySetting: 'block_only_high',
        personGeneration: 'allow_all',
        outputOptions: { mimeType: 'image/jpeg' },
        ...sample_step && { baseSteps: sample_step }
      }
    };

    // Free memory
    person_image_base64 = null;
    garment_image_base64 = null;

    let predictions = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[VirtualTryOnTool][${requestId}] Calling Google Vertex AI, attempt ${attempt}/${MAX_RETRIES}.`);
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[VirtualTryOnTool][${requestId}] API call failed with status ${response.status} on attempt ${attempt}. Body: ${errText}`);
        if (attempt === MAX_RETRIES) {
          throw new Error(`API call failed with status ${response.status} after ${MAX_RETRIES} attempts: ${errText}`);
        }
        await new Promise((resolve)=>setTimeout(resolve, RETRY_DELAY_MS * attempt));
        continue;
      }

      const responseData = await response.json();
      const potentialPredictions = responseData.predictions;
      const raiFilteredReason = potentialPredictions?.[0]?.raiFilteredReason;
      if (raiFilteredReason) {
        console.warn(`[VirtualTryOnTool][${requestId}] Safety filter triggered on attempt ${attempt}. Reason: ${raiFilteredReason}. Retrying...`);
        if (attempt === MAX_RETRIES) {
          throw new Error(`Generation failed due to repeated safety filter blocks. Last reason: ${raiFilteredReason}`);
        }
        await new Promise((resolve)=>setTimeout(resolve, RETRY_DELAY_MS * attempt));
        continue;
      }

      if (potentialPredictions && Array.isArray(potentialPredictions) && potentialPredictions.length > 0 && potentialPredictions.every((p)=>p && p.bytesBase64Encoded)) {
        console.log(`[VirtualTryOnTool][${requestId}] Successfully received and validated ${potentialPredictions.length} predictions on attempt ${attempt}.`);
        predictions = potentialPredictions;
        break;
      } else {
        console.warn(`[VirtualTryOnTool][${requestId}] Invalid or empty prediction data received on attempt ${attempt}. Full response: ${JSON.stringify(responseData)}`);
        if (attempt === MAX_RETRIES) {
          throw new Error("API returned invalid or empty prediction data after all retries.");
        }
        await new Promise((resolve)=>setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }

    if (!predictions) {
      throw new Error("Failed to get a valid response from the AI model after all retries.");
    }

    const generatedImages = predictions.map((p)=>{
      if (!p.bytesBase64Encoded) {
        console.error(`[VirtualTryOnTool][${requestId}] A prediction object was missing the 'bytesBase64Encoded' field.`);
        throw new Error("An image prediction was returned in an invalid format.");
      }
      return { base64Image: p.bytesBase64Encoded, mimeType: p.mimeType || 'image/png' };
    });

    console.log(`[VirtualTryOnTool][${requestId}] Job complete. Returning ${generatedImages.length} results.`);
    return new Response(JSON.stringify({ generatedImages }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error(`[VirtualTryOnTool][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
