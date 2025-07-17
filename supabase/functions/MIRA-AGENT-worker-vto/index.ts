import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleAuth } from "npm:google-auth-library";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { delay } from "https://deno.land/std@0.224.0/async/delay.ts";

// --- Environment Variable Validation (Fail Fast) ---
const requiredEnv = <const>[
  "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_VERTEX_AI_SA_KEY_JSON", "GOOGLE_PROJECT_ID"
];
for (const key of requiredEnv) {
  if (!Deno.env.get(key)) throw new Error(`FATAL: Missing required env var ${key}`);
}
const {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  GOOGLE_VERTEX_AI_SA_KEY_JSON, GOOGLE_PROJECT_ID,
} = Object.fromEntries(requiredEnv.map((k) => [k, Deno.env.get(k)!]));

const REGION = "us-central1";
const MODEL_ID = "virtual-try-on-exp-05-31";
const GENERATED_IMAGES_BUCKET = 'mira-generations';

// --- Utility Functions ---
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

async function retry<T>(fn: () => Promise<T>, attempts = 3, baseDelay = 500, label = "operation"): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        const wait = baseDelay * 2 ** i + Math.random() * baseDelay;
        console.warn(`[retry] ${label} attempt ${i + 1}/${attempts} failed. Retrying in ${wait.toFixed(0)}ms...`, err);
        await delay(wait);
      }
    }
  }
  throw lastErr;
}

async function downloadFromSupabase(sb: SupabaseClient, publicUrl: string): Promise<Blob> {
  const url = new URL(publicUrl);
  const pathSegments = url.pathname.split('/');
  const objectSegmentIndex = pathSegments.indexOf('object');
  if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) throw new Error(`Could not parse bucket name from URL: ${publicUrl}`);
  const bucketName = pathSegments[objectSegmentIndex + 2];
  const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
  if (!bucketName || !filePath) throw new Error(`Could not parse bucket or path from URL: ${publicUrl}`);
  
  const { data, error } = await sb.storage.from(bucketName).download(filePath);
  if (error) throw new Error(`Supabase download error (${filePath}): ${error.message}`);
  if (!data) throw new Error(`Supabase storage returned no data for file: ${filePath}`);
  return data;
}

// --- Main Handler ---
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const { record: job } = await req.json();
  const logPrefix = `[VTO-Worker][${job.id}]`;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    console.log(`${logPrefix} Worker started. Status: ${job.status}`);
    await supabase.from('mira-agent-vto-jobs').update({ status: 'processing' }).eq('id', job.id);

    const personBlob = await retry(() => downloadFromSupabase(supabase, job.person_image_url), 3, 500, 'download-person-image');
    const garmentBlob = await retry(() => downloadFromSupabase(supabase, job.garment_image_url), 3, 500, 'download-garment-image');
    
    const [person_image_base64, garment_image_base64] = await Promise.all([
        encodeBase64(await personBlob.arrayBuffer()),
        encodeBase64(await garmentBlob.arrayBuffer())
    ]);
    console.log(`${logPrefix} Images downloaded and encoded.`);

    const auth = new GoogleAuth({ credentials: JSON.parse(GOOGLE_VERTEX_AI_SA_KEY_JSON), scopes: "https://www.googleapis.com/auth/cloud-platform" });
    const accessToken = await retry(() => auth.getAccessToken(), 3, 500, 'get-google-token');
    if (!accessToken) throw new Error("Failed to get Google Auth token after retries.");
    console.log(`${logPrefix} Google authentication successful.`);

    const apiUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}:predict`;
    const requestBody = {
      instances: [{
        personImage: { image: { bytesBase64Encoded: person_image_base64 } },
        productImages: [{ image: { bytesBase64Encoded: garment_image_base64 } }]
      }],
      parameters: {
        sampleCount: job.metadata?.sample_count || 1,
        addWatermark: false,
        ...(job.metadata?.sample_step !== undefined && { sampleStep: job.metadata.sample_step })
      }
    };

    const responseText = await retry(async () => {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 60_000); // 60s timeout
        const r = await fetch(apiUrl, {
          method: "POST", signal: ctrl.signal,
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(requestBody),
        }).finally(() => clearTimeout(timeout));
        const txt = await r.text();
        if (!r.ok) throw new Error(`Vertex ${r.status}: ${txt.slice(0, 200)}`);
        return txt;
    }, 3, 1000, 'vertex-predict');

    const { predictions } = JSON.parse(responseText);
    if (!Array.isArray(predictions) || predictions.length === 0 || !predictions[0].bytesBase64Encoded) {
      throw new Error("Vertex response missing valid predictions.");
    }
    
    const finalImageBuffer = decodeBase64(predictions[0].bytesBase64Encoded);
    const finalFilePath = `${job.user_id}/vto-final/${Date.now()}_vto_result.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(finalFilePath, finalImageBuffer, { contentType: 'image/png', upsert: true });
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);

    await supabase.from('mira-agent-vto-jobs').update({ status: 'completed', final_image_url: publicUrl }).eq('id', job.id);
    console.log(`${logPrefix} Job completed successfully. Final URL: ${publicUrl}`);

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error) {
    console.error(`${logPrefix} Unhandled error:`, error);
    await supabase.from('mira-agent-vto-jobs').update({ status: 'failed', error_message: error.message }).eq('id', job.id);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});