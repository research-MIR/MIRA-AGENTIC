import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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

    console.log(`[ImageProxyV3] Creating signed URL for bucket '${bucketName}' with path '${filePath}'`);

    // Create a short-lived signed URL to access the file securely.
    const { data, error } = await supabase.storage
      .from(bucketName)
      .createSignedUrl(filePath, 300); // Create a URL valid for 5 minutes

    if (error) {
      throw error;
    }

    return new Response(JSON.stringify({ signedUrl: data.signedUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ImageProxyV3] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});