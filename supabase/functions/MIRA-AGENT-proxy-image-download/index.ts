import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url) {
      throw new Error("URL parameter is required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const urlObject = new URL(url);
    const pathParts = urlObject.pathname.split('/public/');
    if (pathParts.length < 2) {
        throw new Error(`Could not parse a valid storage path from the provided URL: ${url}`);
    }
    
    const [bucketName, ...filePathParts] = pathParts[1].split('/');
    const filePath = filePathParts.join('/');

    if (!bucketName || !filePath) {
        throw new Error(`Could not extract a bucket name or file path from the URL: ${url}`);
    }

    console.log(`[ImageProxyV2] Creating signed URL for bucket '${bucketName}' with path '${filePath}'`);

    // Create a short-lived signed URL to access the file securely.
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(filePath, 60); // Expires in 60 seconds

    if (signedUrlError) {
      throw new Error(`Failed to create signed URL: ${signedUrlError.message}`);
    }

    console.log(`[ImageProxyV2] Fetching image from signed URL...`);
    const response = await fetch(signedUrlData.signedUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch image from signed URL. Status: ${response.status}`);
    }

    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = encodeBase64(buffer);
    
    return new Response(JSON.stringify({ base64, mimeType: blob.type }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ImageProxyV2] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});