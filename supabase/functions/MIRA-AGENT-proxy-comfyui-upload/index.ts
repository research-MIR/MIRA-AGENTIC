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
    const formData = await req.formData();
    const image = formData.get('image');
    const comfyui_address = formData.get('comfyui_address');

    if (!image || !(image instanceof File)) {
      throw new Error("Missing 'image' in form data.");
    }
    if (!comfyui_address || typeof comfyui_address !== 'string') {
      throw new Error("Missing 'comfyui_address' in form data.");
    }

    const sanitizedAddress = comfyui_address.replace(/\/+$/, "");
    const uploadUrl = `${sanitizedAddress}/upload/image`;

    const uploadFormData = new FormData();
    uploadFormData.append('image', image, image.name);
    uploadFormData.append('overwrite', 'true'); // Allow overwriting for simplicity in this tool

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: uploadFormData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ComfyUI upload failed with status ${response.status}: ${errorText}`);
    }

    const responseData = await response.json();

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ComfyUI Upload Proxy Error]:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});