import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

type BitStudioImageType = 
  | 'virtual-try-on-person' 
  | 'virtual-try-on-outfit' 
  | 'inpaint-base' 
  | 'inpaint-mask';

async function uploadToBitStudio(fileBlob: Blob, type: BitStudioImageType, filename: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', fileBlob, filename);
  formData.append('type', type);

  const response = await fetch(`${BITSTUDIO_API_BASE}/images`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BitStudio upload failed for type ${type}: ${errorText}`);
  }
  const result = await response.json();
  if (!result.id) throw new Error(`BitStudio upload for ${type} did not return an ID.`);
  return result.id;
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathStartIndex = url.pathname.indexOf(UPLOAD_BUCKET) + UPLOAD_BUCKET.length + 1;
    const filePath = decodeURIComponent(url.pathname.substring(pathStartIndex));

    if (!filePath) {
        throw new Error(`Could not parse file path from URL: ${publicUrl}`);
    }

    console.log(`[BitStudioProxy] Downloading from storage path: ${filePath}`);
    const { data, error } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath);

    if (error) {
        throw new Error(`Failed to download from Supabase storage: ${error.message}`);
    }
    return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const body = await req.json();
    const { user_id, mode } = body;
    if (!user_id || !mode) {
      throw new Error("user_id and mode are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    let newJobId;

    if (mode === 'inpaint') {
      const { source_image_base64, mask_image_base64, prompt } = body;
      if (!source_image_base64 || !mask_image_base64 || !prompt) throw new Error("source_image_base64, mask_image_base64, and prompt are required for inpaint mode.");

      const sourceBlob = new Blob([decodeBase64(source_image_base64)], { type: 'image/png' });
      const maskBlob = new Blob([decodeBase64(mask_image_base64)], { type: 'image/png' });

      // FIX: Use correct image types from BitStudio docs
      const [sourceImageId, maskImageId] = await Promise.all([
        uploadToBitStudio(sourceBlob, 'inpaint-base', 'source.png'),
        uploadToBitStudio(maskBlob, 'inpaint-mask', 'mask.png')
      ]);

      // FIX: Use correct endpoint and payload structure
      const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${sourceImageId}/inpaint`;
      const inpaintPayload = { mask_image_id: maskImageId, prompt };
      
      const inpaintResponse = await fetch(inpaintUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(inpaintPayload)
      });
      if (!inpaintResponse.ok) throw new Error(`BitStudio inpainting request failed: ${await inpaintResponse.text()}`);
      const inpaintResult = await inpaintResponse.json();
      const taskId = inpaintResult[0]?.id;
      if (!taskId) throw new Error("BitStudio did not return a task ID for the inpainting job.");

      const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
        user_id, mode, status: 'queued', bitstudio_task_id: taskId,
      }).select('id').single();
      if (insertError) throw insertError;
      newJobId = newJob.id;

    } else { // Default to virtual-try-on
      const { person_image_url, garment_image_url, resolution, num_images, prompt } = body;
      if (!person_image_url || !garment_image_url) throw new Error("person_image_url and garment_image_url are required for try-on mode.");

      const [personBlob, garmentBlob] = await Promise.all([
        downloadFromSupabase(supabase, person_image_url),
        downloadFromSupabase(supabase, garment_image_url)
      ]);

      const [personImageId, outfitImageId] = await Promise.all([
        uploadToBitStudio(personBlob, 'virtual-try-on-person', 'person.webp'),
        uploadToBitStudio(garmentBlob, 'virtual-try-on-outfit', 'garment.webp')
      ]);

      const vtoUrl = `${BITSTUDIO_API_BASE}/images/virtual-try-on`;
      const vtoPayload: any = {
        person_image_id: personImageId,
        outfit_image_id: outfitImageId,
        resolution: resolution || "standard",
        num_images: num_images || 1,
      };
      if (prompt) vtoPayload.prompt = prompt;

      const vtoResponse = await fetch(vtoUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(vtoPayload)
      });
      if (!vtoResponse.ok) throw new Error(`BitStudio VTO request failed: ${await vtoResponse.text()}`);
      const vtoResult = await vtoResponse.json();
      const taskId = vtoResult[0]?.id;
      if (!taskId) throw new Error("BitStudio did not return a task ID for the VTO job.");

      const { data: newJob, error: insertError } = await supabase.from('mira-agent-bitstudio-jobs').insert({
        user_id, mode, status: 'queued', source_person_image_url: person_image_url, source_garment_image_url: garment_image_url,
        bitstudio_person_image_id: personImageId, bitstudio_garment_image_id: outfitImageId, bitstudio_task_id: taskId,
      }).select('id').single();
      if (insertError) throw insertError;
      newJobId = newJob.id;
    }

    supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id: newJobId } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[BitStudioProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});