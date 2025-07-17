import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleAuth } from "npm:google-auth-library";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_VERTEX_AI_SA_KEY_JSON = Deno.env.get('GOOGLE_VERTEX_AI_SA_KEY_JSON');
const GOOGLE_PROJECT_ID = Deno.env.get('GOOGLE_PROJECT_ID');
const REGION = 'us-central1';
const MODEL_ID = 'virtual-try-on-exp-05-31';

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(buffer);
};

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    if (publicUrl.includes('/sign/')) {
        const response = await fetch(publicUrl);
        if (!response.ok) throw new Error(`Failed to download from signed URL: ${response.statusText}`);
        return await response.blob();
    }
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) throw new Error(`Could not parse bucket name from Supabase URL: ${publicUrl}`);
    const bucketName = pathSegments[objectSegmentIndex + 2];
    const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    if (!bucketName || !filePath) throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    return data;
}

function parseStoragePathFromUrl(url: string): { bucket: string, path: string } | null {
    try {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/');
        const objectSegmentIndex = pathSegments.indexOf('object');
        if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
            return null;
        }
        const bucket = pathSegments[objectSegmentIndex + 2];
        const path = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
        if (!bucket || !path) return null;
        return { bucket, path };
    } catch (e) {
        return null;
    }
}

serve(async (req) => {
  const requestId = `vto-tool-${Date.now()}`;
  console.log(`[VirtualTryOnTool][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { person_image_url, garment_image_url, sample_step } = await req.json();
  
  try {
    if (!GOOGLE_VERTEX_AI_SA_KEY_JSON || !GOOGLE_PROJECT_ID) {
      throw new Error("Server configuration error: Missing Google Cloud credentials.");
    }

    if (!person_image_url || !garment_image_url) {
      throw new Error("person_image_url and garment_image_url are required.");
    }
    console.log(`[VirtualTryOnTool][${requestId}] Received URLs. Person: ${person_image_url}, Garment: ${garment_image_url}`);

    console.log(`[VirtualTryOnTool][${requestId}] Downloading images from storage...`);
    const [personBlob, garmentBlob] = await Promise.all([
        downloadFromSupabase(supabase, person_image_url),
        downloadFromSupabase(supabase, garment_image_url)
    ]);
    console.log(`[VirtualTryOnTool][${requestId}] Images downloaded successfully.`);

    console.log(`[VirtualTryOnTool][${requestId}] Encoding images to base64...`);
    const [person_image_base64, garment_image_base64] = await Promise.all([
        blobToBase64(personBlob),
        blobToBase64(garmentBlob)
    ]);
    console.log(`[VirtualTryOnTool][${requestId}] Images encoded.`);

    console.log(`[VirtualTryOnTool][${requestId}] Authenticating with Google...`);
    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_VERTEX_AI_SA_KEY_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const accessToken = await auth.getAccessToken();
    console.log(`[VirtualTryOnTool][${requestId}] Google authentication successful.`);

    const apiUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}:predict`;

    const requestBody = {
      instances: [{
        personImage: {
          image: {
            bytesBase64Encoded: person_image_base64
          }
        },
        productImages: [{
          image: {
            bytesBase64Encoded: garment_image_base64
          }
        }]
      }],
      parameters: {
        sampleCount: 1,
        addWatermark: false,
        ...(sample_step && { sampleStep: sample_step })
      }
    };

    console.log(`[VirtualTryOnTool][${requestId}] Calling Google Vertex AI at ${apiUrl}...`);
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[VirtualTryOnTool][${requestId}] Google API Error:`, errorBody);
      throw new Error(`API call failed with status ${response.status}: ${errorBody}`);
    }

    const responseData = await response.json();
    const prediction = responseData.predictions?.[0];
    console.log(`[VirtualTryOnTool][${requestId}] Received successful response from Google.`);

    if (!prediction || !prediction.bytesBase64Encoded) {
      throw new Error("API response did not contain a valid image prediction.");
    }

    console.log(`[VirtualTryOnTool][${requestId}] Job complete. Returning result.`);
    return new Response(JSON.stringify({
      base64Image: prediction.bytesBase64Encoded,
      mimeType: prediction.mimeType || 'image/png'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error(`[VirtualTryOnTool][${requestId}] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  } finally {
      // Clean up temporary files
      try {
        const pathsToRemove: string[] = [];
        const personStorageInfo = parseStoragePathFromUrl(person_image_url);
        const garmentStorageInfo = parseStoragePathFromUrl(garment_image_url);

        if (personStorageInfo && personStorageInfo.bucket === 'mira-agent-user-uploads' && personStorageInfo.path.startsWith('tmp/')) {
            pathsToRemove.push(personStorageInfo.path);
        }
        if (garmentStorageInfo && garmentStorageInfo.bucket === 'mira-agent-user-uploads' && garmentStorageInfo.path.startsWith('tmp/')) {
            pathsToRemove.push(garmentStorageInfo.path);
        }

        if (pathsToRemove.length > 0) {
            console.log(`[VirtualTryOnTool][${requestId}] Cleaning up temporary files:`, pathsToRemove);
            const { error: cleanupError } = await supabase.storage.from('mira-agent-user-uploads').remove(pathsToRemove);
            if (cleanupError) {
                console.error(`[VirtualTryOnTool][${requestId}] Failed to clean up temporary files:`, cleanupError.message);
            } else {
                console.log(`[VirtualTryOnTool][${requestId}] Cleanup successful.`);
            }
        }
      } catch (cleanupError) {
          console.error(`[VirtualTryOnTool][${requestId}] Error during cleanup logic:`, cleanupError.message);
      }
  }
});