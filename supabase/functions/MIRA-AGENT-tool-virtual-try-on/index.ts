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

serve(async (req) => {
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

    const [personBlob, garmentBlob] = await Promise.all([
        downloadFromSupabase(supabase, person_image_url),
        downloadFromSupabase(supabase, garment_image_url)
    ]);

    const [person_image_base64, garment_image_base64] = await Promise.all([
        blobToBase64(personBlob),
        blobToBase64(garmentBlob)
    ]);

    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_VERTEX_AI_SA_KEY_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const accessToken = await auth.getAccessToken();

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
      console.error("Google API Error:", errorBody);
      throw new Error(`API call failed with status ${response.status}: ${errorBody}`);
    }

    const responseData = await response.json();
    const prediction = responseData.predictions?.[0];

    if (!prediction || !prediction.bytesBase64Encoded) {
      throw new Error("API response did not contain a valid image prediction.");
    }

    return new Response(JSON.stringify({
      base64Image: prediction.bytesBase64Encoded,
      mimeType: prediction.mimeType || 'image/png'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error("[VirtualTryOnTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  } finally {
      // Clean up temporary files
      try {
        const personPath = new URL(person_image_url).pathname.split('/mira-agent-user-uploads/')[1];
        const garmentPath = new URL(garment_image_url).pathname.split('/mira-agent-user-uploads/')[1];
        const pathsToRemove = [personPath, garmentPath].filter(Boolean);
        if (pathsToRemove.length > 0) {
            await supabase.storage.from('mira-agent-user-uploads').remove(pathsToRemove);
            console.log(`[VirtualTryOnTool] Cleaned up temporary files:`, pathsToRemove);
        }
      } catch (cleanupError) {
          console.error("[VirtualTryOnTool] Failed to clean up temporary files:", cleanupError.message);
      }
  }
});