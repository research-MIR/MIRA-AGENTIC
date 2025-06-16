import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { person_image_url, garment_image_url, user_prompt, user_id } = await req.json();
    if (!person_image_url || !garment_image_url || !user_id) {
      throw new Error("person_image_url, garment_image_url, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Download person image
    const personResponse = await fetch(person_image_url);
    if (!personResponse.ok) throw new Error(`Failed to download person image: ${personResponse.statusText}`);
    const personBlob = await personResponse.blob();
    const person_image_base64 = encodeBase64(await personBlob.arrayBuffer());

    // Download garment image
    const garmentResponse = await fetch(garment_image_url);
    if (!garmentResponse.ok) throw new Error(`Failed to download garment image: ${garmentResponse.statusText}`);
    const garmentBlob = await garmentResponse.blob();
    const garment_image_base64 = encodeBase64(await garmentBlob.arrayBuffer());

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-segmentation-jobs')
      .insert({
        user_id,
        person_image_url,
        garment_image_url,
        user_prompt,
        status: 'queued'
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    // Asynchronously invoke the worker function with the image data
    supabase.functions.invoke('MIRA-AGENT-worker-segmentation', {
      body: { 
        job_id: newJob.id,
        person_image_base64,
        person_image_mime: personBlob.type,
        garment_image_base64,
        garment_image_mime: garmentBlob.type,
        user_prompt
      }
    }).catch(console.error);

    return new Response(JSON.stringify({ jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ProxySegmentation] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});