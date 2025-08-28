import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { encodeBase64, decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const FAL_KEY = Deno.env.get('FAL_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';
const FAL_WEBHOOK_SECRET = Deno.env.get("FAL_WEBHOOK_SECRET");

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const autoDescribeSceneSystemPrompt = `You are an expert, literal scene describer for an AI image outpainting tool. Your task is to analyze an image and create a concise, descriptive prompt that describes a seamless extension of the existing scene. This prompt will be used to generate content that extends beyond the original image's borders.
### Your Internal Thought Process:
1.  **Analyze the Background:** First, determine the type of background in the image. Is it a simple, plain studio backdrop (e.g., a seamless paper roll, a solid color wall), or is it a complex real-world environment (e.g., a city street, a forest, a room)?
2.  **Apply Logic Based on Background Type:**
    -   **If it is a Studio Background:** Your task is to be extremely literal and non-creative. You MUST ONLY describe the existing background. For example: "a seamless, plain, light grey studio background with soft, even lighting." You are FORBIDDEN from adding any new objects, props, or environmental elements. Your only job is to describe the continuation of the existing simple background.
    -   **If it is a Real-World Environment:** Your task is to describe what would logically exist just outside the frame. Describe the environment, lighting, and textures as if they are continuing seamlessly from the original image.
### Core Directives:
1.  **Incorporate User Hints:** If the user provides a hint, it is the primary creative direction for the new, extended areas. Your description must incorporate and expand upon it, while still respecting the Studio vs. Real-World logic.
2.  **DO NOT Describe the Main Subject:** Do not describe the object or person in the center of the image. Your focus is exclusively on the new areas to be generated around it.
3.  **Language:** The final prompt must be in English.
4.  **Output:** Respond with ONLY the final, detailed prompt text. Do not add any other text, notes, or explanations.`;

async function retry<T>(fn: () => Promise<T>, label: string, tries = 5, baseMs = 250): Promise<T> {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      const wait = Math.round((baseMs * 2 ** i) + Math.random() * 100);
      console.warn(`[retry] ${label} failed (${i+1}/${tries}). Waiting ${wait}ms`, e?.message ?? e);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

async function downloadFromPublicUrl(publicUrl: string): Promise<Blob> {
  const res = await fetch(publicUrl, { redirect: "follow", cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch public URL failed: ${res.status}`);
  return await res.blob();
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    return data;
}

async function getImageBlob(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
  try { return await downloadFromSupabase(supabase, publicUrl); }
  catch (e) {
    console.warn("[fallback] storage.download failed, trying fetch()", e?.message ?? e);
    return await downloadFromPublicUrl(publicUrl);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const logPrefix = `[ReframeProxy-Fal]`;
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  fal.config({ credentials: FAL_KEY! });

  try {
    const { user_id, base_image_url, base64_image_data, mime_type, aspect_ratio, prompt: user_hint, parent_vto_job_id = null } = await req.json();
    if (!user_id || (!base_image_url && !base64_image_data) || !aspect_ratio) {
      throw new Error("user_id, aspect_ratio, and either base_image_url or base64_image_data are required.");
    }

    let final_base_image_url = base_image_url;
    let image_blob_for_analysis: Blob;
    let final_mime_type = mime_type;
    let imageBase64ForAnalysis: string;

    if (base64_image_data) {
        console.log(`${logPrefix} Received base64 data. Uploading to get a persistent URL.`);
        const imageBuffer = decodeBase64(base64_image_data);
        final_mime_type = mime_type || 'image/jpeg';
        image_blob_for_analysis = new Blob([imageBuffer], { type: final_mime_type });
        const filePath = `${user_id}/reframe-sources/${Date.now()}-source.jpeg`;
        await retry(() => supabase.storage.from(UPLOAD_BUCKET).upload(filePath, imageBuffer, { contentType: final_mime_type, upsert: true }).then(res => { if (res.error) throw res.error; return res; }), "storage.upload");
        const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
        final_base_image_url = publicUrl;
        imageBase64ForAnalysis = base64_image_data;
        console.log(`${logPrefix} Base image uploaded to: ${final_base_image_url}`);
    } else {
        console.log(`${logPrefix} Received image URL. Downloading for analysis.`);
        image_blob_for_analysis = await retry(() => getImageBlob(supabase, final_base_image_url), "image download");
        final_mime_type = image_blob_for_analysis.type;
        imageBase64ForAnalysis = encodeBase64(await image_blob_for_analysis.arrayBuffer());
    }

    console.log(`${logPrefix} Step 1: Generating filler prompt.`);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const promptResult = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite-preview-06-17",
        contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: final_mime_type, data: imageBase64ForAnalysis } },
            { text: `User Hint: "${user_hint || 'No hint provided.'}"` }
        ]}],
        config: { systemInstruction: { role: "system", parts: [{ text: autoDescribeSceneSystemPrompt }] } }
    });
    const fillerPrompt = promptResult.text.trim();
    if (!fillerPrompt) throw new Error("Auto-describe tool failed to generate a prompt.");
    console.log(`${logPrefix} Generated Filler Prompt: "${fillerPrompt}"`);

    console.log(`${logPrefix} Step 2: Creating tracking job in 'fal_reframe_jobs'.`);
    const { data: newJob } = await retry(() => 
      supabase
      .from('fal_reframe_jobs')
      .insert({
        user_id,
        source_image_url: final_base_image_url,
        target_aspect_ratio: aspect_ratio,
        generated_prompt: fillerPrompt,
        parent_vto_job_id,
        status: 'queued'
      })
      .select('id')
      .single()
      .then(res => { if (res.error) throw res.error; return res; }),
      "fal_reframe_jobs.insert"
    );
    const jobId = newJob.id;

    console.log(`${logPrefix} Step 3: Calling Fal.ai API for job ${jobId}.`);
    const PROJECT_REF = new URL(SUPABASE_URL!).host.split('.')[0];
    const FUNCTIONS_URL = `https://${PROJECT_REF}.functions.supabase.co`;
    const webhookUrl = `${FUNCTIONS_URL}/MIRA-AGENT-webhook-reframe-fal?job_id=${jobId}`;
    const [ratioX, ratioY] = aspect_ratio.split(':').map(Number);
    
    const dataUri = `data:${final_mime_type};base64,${imageBase64ForAnalysis}`;

    const falResult = await fal.queue.submit("comfy/research-MIR/outpaint-fal-api", {
      input: {
        loadimage_1: dataUri,
        "Ratio - X Value": ratioX,
        "Ratio - Y Value": ratioY,
        "Filler_Prompt": fillerPrompt
      },
      webhook: {
        url: webhookUrl,
        headers: { "x-webhook-secret": FAL_WEBHOOK_SECRET ?? "" }
      }
    });

    console.log(`${logPrefix} Step 4: Updating job ${jobId} with Fal request ID ${falResult.request_id}.`);
    await retry(() => 
      supabase
      .from('fal_reframe_jobs')
      .update({ fal_request_id: falResult.request_id, status: 'processing' })
      .eq('id', jobId)
      .then(res => { if (res.error) throw res.error; return res; }),
      "fal_reframe_jobs.update"
    );

    return new Response(JSON.stringify({ success: true, jobId: jobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});