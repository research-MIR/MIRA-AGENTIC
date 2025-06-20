import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';

async function uploadToBitStudio(file: Blob, type: string, filename: string) {
  if (!BITSTUDIO_API_KEY) throw new Error("BitStudio API key is not configured.");
  
  const formData = new FormData();
  formData.append('file', file, filename);
  formData.append('type', type);

  const response = await fetch(`${BITSTUDIO_API_BASE}/images`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`BitStudio Upload Error for type ${type}:`, errorText);
    throw new Error(`BitStudio upload failed for type ${type}.`);
  }
  const result = await response.json();
  return result.id;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { 
      person_image_data, // base64
      garment_image_data, // base64
      mask_image_data, // base64, for pro mode
      mode, // 'base' or 'pro'
      user_id,
      prompt
    } = await req.json();

    if (!user_id || !mode || !person_image_data || !garment_image_data) {
      throw new Error("Missing required parameters.");
    }
    if (mode === 'pro' && !mask_image_data) {
      throw new Error("Mask image is required for Pro mode.");
    }

    const { data: job, error: jobInsertError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .insert({ user_id, mode, status: 'uploading' })
      .select('id')
      .single();
    if (jobInsertError) throw jobInsertError;
    const jobId = job.id;

    const personBlob = new Blob([decodeBase64(person_image_data)], { type: 'image/webp' });
    const garmentBlob = new Blob([decodeBase64(garment_image_data)], { type: 'image/webp' });
    
    const personStoragePath = `${user_id}/vto_person_${jobId}.webp`;
    const garmentStoragePath = `${user_id}/vto_garment_${jobId}.webp`;

    const [personImageId, garmentImageId] = await Promise.all([
        uploadToBitStudio(personBlob, 'virtual-try-on-person', `person_${jobId}.webp`),
        uploadToBitStudio(garmentBlob, 'virtual-try-on-outfit', `garment_${jobId}.webp`),
        supabase.storage.from(UPLOAD_BUCKET).upload(personStoragePath, personBlob, { contentType: 'image/webp', upsert: true }),
        supabase.storage.from(UPLOAD_BUCKET).upload(garmentStoragePath, garmentBlob, { contentType: 'image/webp', upsert: true })
    ]);

    const { data: { publicUrl: sourcePersonUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(personStoragePath);
    const { data: { publicUrl: sourceGarmentUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(garmentStoragePath);

    await supabase.from('mira-agent-bitstudio-jobs').update({
        source_person_image_url: sourcePersonUrl,
        source_garment_image_url: sourceGarmentUrl,
        bitstudio_person_image_id: personImageId,
        bitstudio_garment_image_id: garmentImageId,
    }).eq('id', jobId);

    let taskId;
    if (mode === 'base') {
      const response = await fetch(`${BITSTUDIO_API_BASE}/images/virtual-try-on`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            person_image_id: personImageId, 
            outfit_image_id: garmentImageId, 
            prompt: prompt || "professional portrait, high quality",
            resolution: "standard"
        })
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      taskId = result[0].id;
    } else { // Pro mode
      const maskBlob = new Blob([decodeBase64(mask_image_data)], { type: 'image/png' });
      const maskImageId = await uploadToBitStudio(maskBlob, 'inpaint-mask', `mask_${jobId}.png`);
      await supabase.from('mira-agent-bitstudio-jobs').update({ bitstudio_mask_image_id: maskImageId }).eq('id', jobId);

      const response = await fetch(`${BITSTUDIO_API_BASE}/images/${personImageId}/inpaint`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mask_image_id: maskImageId, reference_image_id: garmentImageId, prompt })
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      taskId = result[0].id;
    }

    await supabase.from('mira-agent-bitstudio-jobs').update({ bitstudio_task_id: taskId, status: 'queued' }).eq('id', jobId);
    supabase.functions.invoke('MIRA-AGENT-poller-bitstudio-vto', { body: { job_id: jobId } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error("[BitStudioProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});