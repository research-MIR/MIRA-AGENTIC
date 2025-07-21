import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");
  
  const logPrefix = `[ReframeOrchestrator][${job_id}]`;

  try {
    console.log(`${logPrefix} Starting orchestration.`);
    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('context, user_id').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const { context } = job;
    const { base_image_url, aspect_ratio } = context;
    if (!base_image_url || !aspect_ratio) throw new Error("Missing base_image_url or aspect_ratio for mask generation.");

    const url = new URL(base_image_url);
    const pathPrefix = `/storage/v1/object/public/${UPLOAD_BUCKET}/`;
    const imagePath = decodeURIComponent(url.pathname.substring(pathPrefix.length));
    const { data: blob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(imagePath);
    if (downloadError) throw new Error(`Failed to download base image: ${downloadError.message}`);
    
    const originalImage = await loadImage(new Uint8Array(await blob.arrayBuffer()));
    const originalW = originalImage.width();
    const originalH = originalImage.height();
    
    const [targetW, targetH] = aspect_ratio.split(':').map(Number);
    const targetRatio = targetW / targetH;
    const originalRatio = originalW / originalH;

    let newW, newH;
    if (targetRatio > originalRatio) {
      newW = Math.round(originalH * targetRatio);
      newH = originalH;
    } else {
      newH = Math.round(originalW / targetRatio);
      newW = originalW;
    }
    
    const xOffset = (newW - originalW) / 2;
    const yOffset = (newH - originalH) / 2;

    // Generate mask
    const maskCanvas = createCanvas(newW, newH);
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.fillStyle = 'white';
    maskCtx.fillRect(0, 0, newW, newH);
    const featherAmount = Math.min(Math.max(2, Math.round(Math.min(originalW, originalH) * 0.005)), 48);
    maskCtx.fillStyle = 'black';
    maskCtx.shadowColor = 'black';
    maskCtx.shadowBlur = featherAmount;
    maskCtx.fillRect(xOffset, yOffset, originalW, originalH);
    const maskBuffer = maskCanvas.toBuffer('image/png');
    if (maskBuffer.length === 0) throw new Error("FATAL: Generated mask buffer is empty.");

    // Generate new base image IN MEMORY for prompt generation, but don't upload it
    const newBaseCanvas = createCanvas(newW, newH);
    const newBaseCtx = newBaseCanvas.getContext('2d');
    newBaseCtx.fillStyle = 'white';
    newBaseCtx.fillRect(0, 0, newW, newH);
    newBaseCtx.drawImage(originalImage, xOffset, yOffset);
    const newBaseBuffer = newBaseCanvas.toBuffer('image/png');
    if (newBaseBuffer.length === 0) throw new Error("FATAL: Generated base image buffer is empty.");
    const baseImageForPromptingB64 = encodeBase64(newBaseBuffer);

    // Upload ONLY the mask
    const uploadFile = async (buffer: Uint8Array, filename: string, contentType: string) => {
      const filePath = `${job.user_id}/reframe-generated/${job_id}-${filename}`;
      const { error: uploadError } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, buffer, { contentType });
      if (uploadError) throw new Error(`Supabase storage upload failed for ${filename}: ${uploadError.message}`);
      const { data: urlData } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
      if (!urlData || !urlData.publicUrl) throw new Error(`Failed to get public URL for uploaded file: ${filePath}`);
      return urlData.publicUrl;
    };

    const final_mask_url = await uploadFile(maskBuffer, 'mask.png', 'image/png');
    
    console.log(`${logPrefix} Invoking auto-describe-scene tool to generate intelligent prompt...`);
    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-auto-describe-scene', {
        body: {
            base_image_base64: baseImageForPromptingB64,
            user_hint: context.prompt || "",
            mime_type: 'image/png'
        }
    });
    if (promptError) throw new Error(`Auto-describe-scene tool failed: ${promptError.message}`);
    const finalPrompt = promptData.scene_prompt;
    console.log(`${logPrefix} Generated intelligent prompt: "${finalPrompt}"`);

    await supabase.from('mira-agent-jobs').update({
        context: { 
            ...context, 
            mask_image_url: final_mask_url,
            final_prompt_used: finalPrompt,
            // IMPORTANT: We keep the ORIGINAL base_image_url for the worker
        }
    }).eq('id', job_id);

    console.log(`${logPrefix} Invoking final reframe tool with original base image and generated mask.`);
    const { error: reframeError } = await supabase.functions.invoke('MIRA-AGENT-tool-reframe-image', {
      body: { job_id }
    });
    if (reframeError) throw new Error(`Reframe tool invocation failed: ${reframeError.message}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', job_id);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});