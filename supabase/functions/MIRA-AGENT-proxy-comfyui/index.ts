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
    const { comfyui_address, prompt_workflow } = await req.json();
    if (!comfyui_address || !prompt_workflow) {
      throw new Error("Missing 'comfyui_address' or 'prompt_workflow' in request body.");
    }

    console.log(`[ComfyUI Proxy] Forwarding request to: ${comfyui_address}/prompt`);

    const response = await fetch(`${comfyui_address}/prompt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true' // Add this header to bypass the ngrok warning page
      },
      body: JSON.stringify(prompt_workflow),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ComfyUI server responded with status ${response.status}: ${errorText}`);
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ComfyUI Proxy Error]:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});