import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    if (!url) {
      throw new Error("URL parameter is required.");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from ${url}. Status: ${response.status}`);
    }

    const blob = await response.blob();
    
    return new Response(blob, {
      headers: { ...corsHeaders, 'Content-Type': blob.type || 'application/octet-stream' },
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