import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const UPLOAD_BUCKET = 'mira-agent-user-uploads';

async function uploadImageToComfyUI(comfyUiUrl: string, image: Blob, filename: string) {
  const uploadFormData = new FormData();
  uploadFormData.append('image', image, filename);
  uploadFormData.append('overwrite', 'true');
  const uploadUrl = `${comfyUiUrl}/upload/image`;
  const response = await fetch(uploadUrl, {
    method: 'POST',
    body: uploadFormData
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ComfyUI upload failed with status ${response.status}: ${errorText}`);
  }
  const data = await response.json();
  if (!data.name) throw new Error("ComfyUI did not return a filename for the uploaded image.");
  return data.name;
}

serve(async (req) => {
  const COMFYUI_ENDPOINT_URL = Deno.env.get('COMFYUI_ENDPOINT_URL');
  const requestId = req.headers.get("x-request-id") || `queue-proxy-${Date.now()}`;
  console.log(`[QueueProxy][${requestId}] Function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!COMFYUI_ENDPOINT_URL) {
    console.error(`[QueueProxy][${requestId}] CRITICAL: COMFYUI_ENDPOINT_URL secret is not set.`);
    return new Response(JSON.stringify({ error: "Server configuration error: COMFYUI_ENDPOINT_URL secret is not set." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500
    });
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const sanitizedAddress = COMFYUI_ENDPOINT_URL.replace(/\/+$/, "");

  try {
    let body;
    let imageFile: Blob | null = null;
    let sourceImageUrl: string | null = null;
    let originalFilename = 'image.png';

    const contentType = req.headers.get('content-type');
    if (contentType && contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      body = Object.fromEntries(formData.entries());
      const image = formData.get('image');
      if (image instanceof File) {
        imageFile = image;
        originalFilename = image.name;
      }
    } else {
      body = await req.json();
      if (body.image_url) {
        sourceImageUrl = body.image_url;
        const imageResponse = await fetch(body.image_url);
        if (!imageResponse.ok) throw new Error(`Failed to download image from URL: ${imageResponse.statusText}`);
        imageFile = await imageResponse.blob();
        originalFilename = body.image_url.split('/').pop() || 'image.png';
      } else if (body.base64_image_data) {
        const imageBuffer = decodeBase64(body.base64_image_data);
        imageFile = new Blob([imageBuffer], { type: body.mime_type || 'image/png' });
        originalFilename = `agent_history_image.png`;
      }
    }

    const { invoker_user_id, upscale_factor, original_prompt_for_gallery, main_agent_job_id, prompt_text, source } = body;
    if (!invoker_user_id) throw new Error("Missing required parameter: invoker_user_id");
    if (!prompt_text) throw new Error("Missing required parameter: prompt_text");
    if (!imageFile) throw new Error("Missing image data.");

    // If the sourceImageUrl is not already a persistent URL, upload it to Supabase Storage first.
    if (!sourceImageUrl || sourceImageUrl.startsWith('local_file_')) {
        console.log(`[QueueProxy][${requestId}] Uploading source image to Supabase Storage...`);
        const filePath = `${invoker_user_id}/source/${Date.now()}-${originalFilename}`;
        const { error: uploadError } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, imageFile, { contentType: imageFile.type });
        if (uploadError) throw new Error(`Failed to upload source image to storage: ${uploadError.message}`);
        const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
        sourceImageUrl = publicUrl;
        console.log(`[QueueProxy][${requestId}] Source image stored at: ${sourceImageUrl}`);
    }

    const uploadedFilename = await uploadImageToComfyUI(sanitizedAddress, imageFile, originalFilename);
    console.log(`[QueueProxy][${requestId}] Successfully uploaded image to ComfyUI. Filename: ${uploadedFilename}`);

    const workflow = JSON.parse(workflowTemplate);
    workflow['404'].inputs.image = uploadedFilename;
    workflow['307'].inputs.String = prompt_text;
    workflow['407'].inputs.seed = Math.floor(Math.random() * 1000000000000000);
    if (upscale_factor) {
      workflow['410'].inputs.value = parseFloat(upscale_factor);
    }

    const queueUrl = `${sanitizedAddress}/prompt`;
    const payload = { prompt: workflow };
    console.log(`[QueueProxy][${requestId}] Sending prompt to: ${queueUrl}`);
    const response = await fetch(queueUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ComfyUI server responded with status ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    if (!data.prompt_id) throw new Error("ComfyUI did not return a prompt_id.");

    const { data: newJob, error: insertError } = await supabase.from('mira-agent-comfyui-jobs').insert({
      user_id: invoker_user_id,
      comfyui_address: sanitizedAddress,
      comfyui_prompt_id: data.prompt_id,
      status: 'queued',
      main_agent_job_id: main_agent_job_id,
      metadata: {
        source: source || 'refiner',
        prompt: prompt_text,
        original_prompt_for_gallery: original_prompt_for_gallery || `Refined: ${prompt_text?.slice(0, 40) || 'image'}...`,
        invoker_user_id: invoker_user_id,
        source_image_url: sourceImageUrl // Now this is always a persistent URL
      }
    }).select('id').single();

    if (insertError) throw insertError;

    supabase.functions.invoke('MIRA-AGENT-poller-comfyui', {
      body: { job_id: newJob.id }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error(`[QueueProxy][${requestId}] Unhandled error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});