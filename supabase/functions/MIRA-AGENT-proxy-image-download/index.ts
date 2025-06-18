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

    // Initialize Supabase client with admin rights
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Parse the bucket and path from the public URL
    // Example: https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path/to/file.png>
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

    console.log(`[ImageProxy] Downloading from bucket '${bucketName}' with path '${filePath}'`);

    // Download the file directly using the Supabase SDK, which is more reliable than a public fetch
    const { data: blob, error: downloadError } = await supabase.storage
      .from(bucketName)
      .download(filePath);

    if (downloadError) {
      throw new Error(`Supabase storage download failed: ${downloadError.message}`);
    }

    const buffer = await blob.arrayBuffer();
    const base64 = encodeBase64(buffer);
    
    return new Response(JSON.stringify({ base64, mimeType: blob.type }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ImageProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});