import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  const requestId = req.headers.get("x-request-id") || `upload-proxy-${Date.now()}`;
  console.log(`[UploadProxy][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const image = formData.get('image');
    const comfyui_address = formData.get('comfyui_address');
    console.log(`[UploadProxy][${requestId}] FormData parsed.`);

    if (!image || !(image instanceof File)) {
      throw new Error("Missing 'image' in form data.");
    }
    if (!comfyui_address || typeof comfyui_address !== 'string') {
      throw new Error("Missing 'comfyui_address' in form data.");
    }

    const sanitizedAddress = comfyui_address.replace(/\/+$/, "");
    const uploadUrl = `${sanitizedAddress}/upload/image`;
    console.log(`[UploadProxy][${requestId}] Uploading to: ${uploadUrl}`);

    const uploadFormData = new FormData();
    uploadFormData.append('image', image, image.name);
    uploadFormData.append('overwrite', 'true');

    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: uploadFormData,
    });

    console.log(`[UploadProxy][${requestId}] Received response from ComfyUI with status: ${response.status}`);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[UploadProxy][${requestId}] ComfyUI upload failed. Response: ${errorText}`);
      throw new Error(`ComfyUI upload failed with status ${response.status}: ${errorText}`);
    }

    const responseData = await response.json();
    console.log(`[UploadProxy][${requestId}] Successfully uploaded. Response data:`, responseData);

    return new Response(JSON.stringify(responseData), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[UploadProxy][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});