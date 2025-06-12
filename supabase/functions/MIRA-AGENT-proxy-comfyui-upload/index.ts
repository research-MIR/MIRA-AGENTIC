import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
  const requestId = req.headers.get("x-request-id") || `upload-proxy-${Date.now()}`;
  console.log(`[UploadProxy][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!COMFYUI_ENDPOINT_URL) {
    console.error(`[UploadProxy][${requestId}] CRITICAL: COMFYUI_ENDPOINT_URL secret is not set.`);
    return new Response(JSON.stringify({ error: "Server configuration error: COMFYUI_ENDPOINT_URL secret is not set." }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
  }

  try {
    const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");
    const uploadUrl = `${sanitizedAddress}/upload/image`;
    const uploadFormData = new FormData();

    const contentType = req.headers.get('content-type');
    if (contentType && contentType.includes('multipart/form-data')) {
        console.log(`[UploadProxy][${requestId}] Handling FormData upload.`);
        const formData = await req.formData();
        const image = formData.get('image');
        if (!image || !(image instanceof File)) {
            throw new Error("Missing 'image' in form data.");
        }
        uploadFormData.append('image', image, image.name);
    } else {
        console.log(`[UploadProxy][${requestId}] Handling JSON body with image_url.`);
        const { image_url } = await req.json();
        if (!image_url) throw new Error("Request must be FormData or JSON with 'image_url'.");

        console.log(`[UploadProxy][${requestId}] Fetching image from URL: ${image_url}`);
        const imageResponse = await fetch(image_url);
        if (!imageResponse.ok) throw new Error(`Failed to download image from URL: ${imageResponse.statusText}`);
        const imageBlob = await imageResponse.blob();
        const filename = image_url.split('/').pop() || 'image.png';
        uploadFormData.append('image', imageBlob, filename);
    }

    uploadFormData.append('overwrite', 'true');
    console.log(`[UploadProxy][${requestId}] Uploading to: ${uploadUrl}`);

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