import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const TEMP_UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    if (publicUrl.includes('/sign/')) {
        const response = await fetch(publicUrl);
        if (!response.ok) throw new Error(`Failed to download from signed URL: ${response.statusText}`);
        return await response.blob();
    }
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) throw new Error(`Could not parse bucket name from Supabase URL: ${publicUrl}`);
    const bucketName = pathSegments[objectSegmentIndex + 2];
    const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    if (!bucketName || !filePath) throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    return data;
}

async function uploadBlobToTemp(supabase: SupabaseClient, blob: Blob, userId: string, type: 'person' | 'garment'): Promise<string> {
    const filePath = `tmp/${userId}/${type}-${Date.now()}.png`;
    const { error } = await supabase.storage.from(TEMP_UPLOAD_BUCKET).upload(filePath, blob, { contentType: 'image/png', upsert: true });
    if (error) throw error;
    const { data: { publicUrl } } = supabase.storage.from(TEMP_UPLOAD_BUCKET).getPublicUrl(filePath);
    return publicUrl;
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

    const jobPromises = pairs.map(async (pair: any, index: number) => {
      const pairLogPrefix = `[VTO-Packs-Orchestrator][Pair ${index + 1}/${pairs.length}]`;
      try {
        console.log(`${pairLogPrefix} Processing pair. Person: ${pair.person_url}, Garment: ${pair.garment_url}`);
        if (engine === 'google') {
          console.log(`${pairLogPrefix} Using Google VTO engine. Downloading assets...`);
          const [personBlob, garmentBlob] = await Promise.all([
            downloadFromSupabase(supabase, pair.person_url),
            downloadFromSupabase(supabase, pair.garment_url)
          ]);
          console.log(`${pairLogPrefix} Assets downloaded. Uploading to temp storage...`);

          const [temp_person_url, temp_garment_url] = await Promise.all([
              uploadBlobToTemp(supabase, personBlob, user_id, 'person'),
              uploadBlobToTemp(supabase, garmentBlob, user_id, 'garment')
          ]);
          console.log(`${pairLogPrefix} Assets uploaded to temp storage. Invoking Google VTO tool...`);

          const { data: vtoResult, error: vtoError } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
            body: { 
                person_image_url: temp_person_url, 
                garment_image_url: temp_garment_url 
            }
          });
          if (vtoError) throw vtoError;
          console.log(`${pairLogPrefix} Google VTO tool successful. Uploading result...`);

          const imageBuffer = decodeBase64(vtoResult.base64Image);
          const filePath = `${user_id}/vto-packs/${Date.now()}_google_vto.png`;
          await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(filePath, imageBuffer, { contentType: vtoResult.mimeType, upsert: true });
          const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
          console.log(`${pairLogPrefix} Result uploaded. Logging completed job record to 'mira-agent-jobs'.`);

          await supabase.from('mira-agent-jobs').insert({
            user_id,
            status: 'complete',
            original_prompt: `VTO Pack: ${pair.person_url.split('/').pop()} + ${pair.garment_url.split('/').pop()}`,
            final_result: {
                isImageGeneration: true,
                images: [{ publicUrl: publicUrl, storagePath: filePath }]
            },
            context: { 
                source: 'vto_pack_google',
                vto_pack_job_id: vtoPackJobId,
                source_person_image_url: pair.person_url,
                source_garment_image_url: pair.garment_url,
            }
          });
          console.log(`${pairLogPrefix} Google VTO job logged successfully.`);

        } else { // Default to bitstudio
          console.log(`${pairLogPrefix} Using BitStudio engine. Invoking proxy...`);
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
          console.log(`${pairLogPrefix} BitStudio proxy invoked successfully.`);
        }
      } catch (err) {
        console.error(`${pairLogPrefix} Failed to queue job for person ${pair.person_url}:`, err);
      }
    });

    Promise.allSettled(jobPromises).then(() => {
        console.log(`[VTO-Packs-Orchestrator] All ${pairs.length} job dispatches have been processed.`);
    });

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