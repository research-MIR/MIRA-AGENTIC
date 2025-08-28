import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';
import { fal } from 'npm:@fal-ai/client@1.5.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const FAL_KEY = Deno.env.get('FAL_KEY');

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

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const logPrefix = `[ReframeProxy-Fal]`;
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  fal.config({ credentials: FAL_KEY! });

  try {
    const { user_id, base_image_url, aspect_ratio, prompt: user_hint, parent_vto_job_id = null } = await req.json();
    if (!user_id || !base_image_url || !aspect_ratio) {
      throw new Error("user_id, base_image_url, and aspect_ratio are required.");
    }

    console.log(`${logPrefix} Step 1: Generating filler prompt.`);
    const imageBlob = await downloadFromSupabase(supabase, base_image_url);
    const imageBase64 = encodeBase64(await imageBlob.arrayBuffer());
    
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const promptResult = await ai.models.generateContent({
        model: "gemini-2.5-flash-lite-preview-06-17",
        contents: [{ role: 'user', parts: [
            { inlineData: { mimeType: imageBlob.type, data: imageBase64 } },
            { text: `User Hint: "${user_hint || 'No hint provided.'}"` }
        ]}],
        config: { systemInstruction: { role: "system", parts: [{ text: autoDescribeSceneSystemPrompt }] } }
    });
    const fillerPrompt = promptResult.text.trim();
    if (!fillerPrompt) throw new Error("Auto-describe tool failed to generate a prompt.");
    console.log(`${logPrefix} Generated Filler Prompt: "${fillerPrompt}"`);

    console.log(`${logPrefix} Step 2: Creating tracking job in 'fal_reframe_jobs'.`);
    const { data: newJob, error: insertError } = await supabase
      .from('fal_reframe_jobs')
      .insert({
        user_id,
        source_image_url: base_image_url,
        target_aspect_ratio: aspect_ratio,
        generated_prompt: fillerPrompt,
        parent_vto_job_id,
        status: 'queued'
      })
      .select('id')
      .single();
    if (insertError) throw insertError;
    const jobId = newJob.id;

    console.log(`${logPrefix} Step 3: Calling Fal.ai API for job ${jobId}.`);
    const webhookUrl = `${SUPABASE_URL}/functions/v1/MIRA-AGENT-webhook-reframe-fal?job_id=${jobId}`;
    const [ratioX, ratioY] = aspect_ratio.split(':').map(Number);

    const falResult = await fal.queue.submit("comfy/research-MIR/outpaint-fal-api", {
      input: {
        loadimage_1: base_image_url,
        "Ratio - X Value": ratioX,
        "Ratio - Y Value": ratioY,
        "Filler_Prompt": fillerPrompt
      },
      webhookUrl: webhookUrl
    });

    console.log(`${logPrefix} Step 4: Updating job ${jobId} with Fal request ID ${falResult.request_id}.`);
    await supabase
      .from('fal_reframe_jobs')
      .update({ fal_request_id: falResult.request_id, status: 'processing' })
      .eq('id', jobId);

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