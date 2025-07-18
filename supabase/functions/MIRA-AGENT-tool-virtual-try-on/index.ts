import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleAuth } from "npm:google-auth-library";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
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
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

// --- DIAGNOSTIC: Global Error Handlers ---
self.addEventListener('unhandledrejection', (event) => {
  console.error(`[GLOBAL UNHANDLED REJECTION] Reason:`, event.reason);
});

self.addEventListener('error', (event) => {
  console.error(`[GLOBAL ERROR] Message: ${event.message}, Filename: ${event.filename}, Lineno: ${event.lineno}, Error:`, event.error);
});
// --- END DIAGNOSTIC ---

const fetchWithRetry = async (url: string, options: RequestInit, maxRetries = MAX_RETRIES, delay = RETRY_DELAY_MS, requestId: string) => {
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
    await new Promise(resolve => setTimeout(resolve, delay * attempt)); // Exponential backoff
  }
  throw new Error("Fetch with retry failed unexpectedly."); // Should not be reached
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(new Uint8Array(buffer)); // Use Uint8Array for safety
};

async function downloadFromSignedUrl(url: string, requestId: string): Promise<Blob> {
    if (!url.includes('/sign/')) {
        throw new Error(`[Downloader][${requestId}] Received a non-signed URL, which is not supported. Please provide a signed URL.`);
    }
    console.log(`[Downloader][${requestId}] Downloading from signed URL.`);
    const response = await fetchWithRetry(url, {}, MAX_RETRIES, RETRY_DELAY_MS, requestId);
    const blob = await response.blob();
    console.log(`[Downloader][${requestId}] Signed URL download successful. Blob size: ${blob.size}`);
    return blob;
}

serve(async (req) => {
  const requestId = `vto-tool-${Date.now()}`;
  console.log(`[VirtualTryOnTool][${requestId}] Function invoked. Running version 2.0 with logging fix.`);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  try {
    if (!GOOGLE_VERTEX_AI_SA_KEY_JSON || !GOOGLE_PROJECT_ID) {
      throw new Error("Server configuration error: Missing Google Cloud credentials.");
    }

    const body = await req.json();
    console.log(`[VirtualTryOnTool][${requestId}] Request body successfully parsed. Keys found: ${Object.keys(body).join(', ')}`);

    const { 
        person_image_url, garment_image_url, 
        person_image_base64: person_b64_input, 
        garment_image_base64: garment_b64_input,
        sample_step,
        sample_count = 1
    } = body;

    let person_image_base64: string | null;
    let garment_image_base64: string | null;

    if (person_b64_input) {
        person_image_base64 = person_b64_input;
    } else if (person_image_url) {
        console.log(`[VirtualTryOnTool][${requestId}] Downloading person image from URL: ${person_image_url}`);
        const personBlob = await downloadFromSignedUrl(person_image_url, requestId);
        person_image_base64 = await blobToBase64(personBlob);
        console.log(`[VirtualTryOnTool][${requestId}] Person image processed. Base64 length: ${person_image_base64.length}`);
    } else {
        throw new Error("Either person_image_url or person_image_base64 is required.");
    }

    if (garment_b64_input) {
        garment_image_base64 = garment_b64_input;
    } else if (garment_image_url) {
        console.log(`[VirtualTryOnTool][${requestId}] Downloading garment image from URL: ${garment_image_url}`);
        const garmentBlob = await downloadFromSignedUrl(garment_image_url, requestId);
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
      instances: [{
        personImage: { image: { bytesBase64Encoded: person_image_base64 } },
        productImages: [{ image: { bytesBase64Encoded: garment_image_base64 } }]
      }],
      parameters: {
        sampleCount: sample_count,
        addWatermark: false,
        ...(sample_step && { sampleStep: sample_step })
      }
    };
    
    // Nullify large objects to free up memory before the large network request
    person_image_base64 = null;
    garment_image_base64 = null;

    console.log(`[VirtualTryOnTool][${requestId}] Calling Google Vertex AI. Payload details: Sample Count: ${sample_count}`);
    const response = await fetchWithRetry(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(requestBody)
    }, MAX_RETRIES, RETRY_DELAY_MS, requestId);

    const responseText = await response.text();
    console.log(`[VirtualTryOnTool][${requestId}] Received raw response from Google. Status: ${response.status}. Body length: ${responseText.length}.`);
    
    const responseData = JSON.parse(responseText);
    const predictions = responseData.predictions;

    if (!predictions || !Array.isArray(predictions) || predictions.length === 0) {
      console.error(`[VirtualTryOnTool][${requestId}] Parsed response did not contain a valid 'predictions' array. Full response:`, JSON.stringify(responseData, null, 2));
      throw new Error("API response did not contain valid image predictions.");
    }

    const generatedImages = predictions.map(p => {
        if (!p.bytesBase64Encoded) {
            console.error(`[VirtualTryOnTool][${requestId}] A prediction object was missing the 'bytesBase64Encoded' field.`);
            throw new Error("An image prediction was returned in an invalid format.");
        }
        return {
            base64Image: p.bytesBase64Encoded,
            mimeType: p.mimeType || 'image/png'
        };
    });

    console.log(`[VirtualTryOnTool][${requestId}] Job complete. Returning ${generatedImages.length} results.`);
    return new Response(JSON.stringify({ generatedImages }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[VirtualTryOnTool][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});