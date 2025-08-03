import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[ReframeWorker][${job_id}]`;

  try {
    console.log(`${logPrefix} Starting job.`);
    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('context, user_id').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const step = job.context.reframe_step || 'start';
    console.log(`${logPrefix} Current step: ${step}`);

    switch (step) {
      case 'start': {
        const { base_image_url, aspect_ratio } = job.context;
        if (!base_image_url || !aspect_ratio) throw new Error("Missing base_image_url or aspect_ratio in job context.");

        console.log(`${logPrefix} Step 'start': Preparing assets.`);
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

        const maskCanvas = createCanvas(newW, newH);
        const maskCtx = maskCanvas.getContext('2d');
        maskCtx.fillStyle = 'white';
        maskCtx.fillRect(0, 0, newW, newH);
        const featherAmount = Math.max(4, Math.round(Math.min(originalW, originalH) * 0.01));
        maskCtx.filter = `blur(${featherAmount}px)`;
        maskCtx.fillStyle = 'black';
        maskCtx.fillRect(xOffset, yOffset, originalW, originalH);
        maskCtx.filter = 'none';
        const maskBuffer = maskCanvas.toBuffer('image/png');

        const newBaseCanvas = createCanvas(newW, newH);
        const newBaseCtx = newBaseCanvas.getContext('2d');
        newBaseCtx.fillStyle = 'white';
        newBaseCtx.fillRect(0, 0, newW, newH);
        newBaseCtx.drawImage(originalImage, xOffset, yOffset);
        const newBaseBuffer = newBaseCanvas.toBuffer('image/png');

        const uploadFile = async (buffer: Uint8Array, filename: string) => {
            const filePath = `${job.user_id}/reframe-generated/${job_id}-${filename}`;
            const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, buffer, { contentType: 'image/png' });
            if (error) throw error;
            const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
            return publicUrl;
        };

        const [new_base_image_url, new_mask_image_url] = await Promise.all([
            uploadFile(newBaseBuffer, 'base.png'),
            uploadFile(maskBuffer, 'mask.png')
        ]);

        await supabase.from('mira-agent-jobs').update({
          context: {
            ...job.context,
            base_image_url: new_base_image_url,
            mask_image_url: new_mask_image_url,
            invert_mask: false,
            reframe_step: 'assets_prepared'
          }
        }).eq('id', job_id);

        console.log(`${logPrefix} Assets prepared. Re-invoking worker for next step.`);
        // AWAIT the invocation to ensure it's queued before this function exits.
        await supabase.functions.invoke('MIRA-AGENT-worker-reframe', { body: { job_id } });
        break;
      }

      case 'assets_prepared': {
        console.log(`${logPrefix} Step 'assets_prepared': Invoking final generation tool.`);
        const { error: reframeError } = await supabase.functions.invoke('MIRA-AGENT-tool-reframe-image', {
          body: { 
            job_id,
            prompt: job.context.prompt || ""
          }
        });
        if (reframeError) throw new Error(`Reframe tool invocation failed: ${reframeError.message}`);
        
        // The final tool will update the status to 'complete' or 'failed'.
        // This worker's job is done.
        console.log(`${logPrefix} Handed off to final generation tool.`);
        break;
      }

      default:
        throw new Error(`Unknown reframe step: ${step}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});