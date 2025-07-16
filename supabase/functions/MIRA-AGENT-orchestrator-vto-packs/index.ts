import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';
const GENERATED_IMAGES_BUCKET = 'mira-generations';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function downloadImageAsBase64(supabase: SupabaseClient, publicUrl: string): Promise<string> {
    const url = new URL(publicUrl);
    const filePath = url.pathname.split(`/${UPLOAD_BUCKET}/`)[1];
    if (!filePath) throw new Error(`Could not parse file path from URL: ${publicUrl}`);

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(filePath);
    if (downloadError) throw new Error(`Supabase download failed: ${downloadError.message}`);

    const buffer = await fileBlob.arrayBuffer();
    return encodeBase64(buffer);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { pairs, user_id, engine = 'bitstudio' } = await req.json();
    if (!pairs || !Array.isArray(pairs) || pairs.length === 0 || !user_id) {
      throw new Error("`pairs` array and `user_id` are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    console.log(`[VTO-Packs-Orchestrator] Received request for ${pairs.length} pairs for user ${user_id} using engine: ${engine}.`);

    const { data: batchJob, error: batchError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .insert({ user_id, metadata: { total_pairs: pairs.length, engine: engine } })
      .select('id')
      .single();
    
    if (batchError) throw batchError;
    const vtoPackJobId = batchJob.id;
    console.log(`[VTO-Packs-Orchestrator] Main batch job ${vtoPackJobId} created.`);

    const jobPromises = pairs.map(async (pair: any) => {
      try {
        if (engine === 'google') {
          const [person_image_base64, garment_image_base64] = await Promise.all([
            downloadImageAsBase64(supabase, pair.person_url),
            downloadImageAsBase64(supabase, pair.garment_url)
          ]);

          const { data: vtoResult, error: vtoError } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
            body: { person_image_base64, garment_image_base64 }
          });
          if (vtoError) throw vtoError;

          const imageBuffer = decodeBase64(vtoResult.base64Image);
          const filePath = `${user_id}/vto-packs/${Date.now()}_google_vto.png`;
          await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: vtoResult.mimeType, upsert: true });
          const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

          await supabase.from('mira-agent-bitstudio-jobs').insert({
            user_id,
            vto_pack_job_id: vtoPackJobId,
            mode: 'base',
            status: 'complete',
            source_person_image_url: pair.person_url,
            source_garment_image_url: pair.garment_url,
            final_image_url: publicUrl,
            metadata: { engine: 'google' }
          });

        } else { // Default to bitstudio
          const { error } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
              body: { 
                  person_image_url: pair.person_url, 
                  garment_image_url: pair.garment_url, 
                  user_id: user_id, 
                  mode: 'base',
                  prompt_appendix: pair.appendix,
                  vto_pack_job_id: vtoPackJobId
              }
          });
          if (error) throw error;
        }
      } catch (err) {
        console.error(`[VTO-Packs-Orchestrator] Failed to queue job for person ${pair.person_url}:`, err);
      }
    });

    Promise.allSettled(jobPromises);

    return new Response(JSON.stringify({ success: true, message: `${pairs.length} jobs have been queued for processing.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-Packs-Orchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});