import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';

async function uploadToBitStudio(fileBlob: Blob, type: 'virtual-try-on-person' | 'virtual-try-on-outfit', filename: string): Promise<string> {
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

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { person_image_url, garment_image_url, user_id, mode } = await req.json();
    if (!person_image_url || !garment_image_url || !user_id || !mode) {
      throw new Error("person_image_url, garment_image_url, user_id, and mode are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 1. Download images from our own Supabase storage
    const [personRes, garmentRes] = await Promise.all([
      fetch(person_image_url),
      fetch(garment_image_url)
    ]);
    if (!personRes.ok || !garmentRes.ok) throw new Error("Failed to download source images.");
    
    const [personBlob, garmentBlob] = await Promise.all([personRes.blob(), garmentRes.blob()]);

    // 2. Upload images to BitStudio to get their IDs
    const [personImageId, outfitImageId] = await Promise.all([
      uploadToBitStudio(personBlob, 'virtual-try-on-person', 'person.webp'),
      uploadToBitStudio(garmentBlob, 'virtual-try-on-outfit', 'garment.webp')
    ]);

    // 3. Start the Virtual Try-On job
    const vtoResponse = await fetch(`${BITSTUDIO_API_BASE}/images/virtual-try-on`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BITSTUDIO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        person_image_id: personImageId,
        outfit_image_id: outfitImageId,
        resolution: "standard",
        num_images: 1
      })
    });
    if (!vtoResponse.ok) throw new Error(`BitStudio VTO request failed: ${await vtoResponse.text()}`);
    const vtoResult = await vtoResponse.json();
    const taskId = vtoResult[0]?.id;
    if (!taskId) throw new Error("BitStudio did not return a task ID for the VTO job.");

    // 4. Create a job record in our database
    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .insert({
        user_id: user_id,
        mode: mode,
        status: 'queued',
        source_person_image_url: person_image_url,
        source_garment_image_url: garment_image_url,
        bitstudio_person_image_id: personImageId,
        bitstudio_garment_image_id: outfitImageId,
        bitstudio_task_id: taskId,
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // 5. Asynchronously start the poller
    supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id: newJob.id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
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