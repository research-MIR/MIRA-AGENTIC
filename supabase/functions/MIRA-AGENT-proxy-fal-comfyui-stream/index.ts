import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const FAL_KEY = Deno.env.get('FAL_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!FAL_KEY) {
    return new Response("FAL_KEY is not set.", { status: 500 });
  }

  const url = new URL(req.url);
  const requestId = url.searchParams.get('requestId');

  if (!requestId) {
    return new Response("requestId query parameter is required.", { status: 400 });
  }

  const falUrl = `https://queue.fal.run/comfy/research-MIR/test/requests/${requestId}/status/stream?logs=1`;

  const response = await fetch(falUrl, {
    headers: {
      'Authorization': `Key ${FAL_KEY}`,
      'Accept': 'text/event-stream',
    },
  });

  if (!response.body) {
    return new Response("Failed to open stream.", { status: 500 });
  }

  return new Response(response.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
});