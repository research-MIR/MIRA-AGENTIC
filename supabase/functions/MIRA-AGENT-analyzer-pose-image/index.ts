import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash"; // Using a fast model for analysis
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const identityPassportSystemPrompt = `You are an expert model scout and casting director. Your task is to analyze the provided image of a model and extract their key visual features into a structured JSON object. Be concise and descriptive.

### Your Output:
Your entire response MUST be a single, valid JSON object with the following keys:
\`\`\`json
{
  "skin_tone": "A descriptive string, e.g., 'fair skin with cool undertones', 'deep brown skin with warm undertones'.",
  "hair_style": "A descriptive string, e.g., 'long, wavy blonde hair', 'short black fade'.",
  "eye_color": "A descriptive string, e.g., 'light blue', 'dark brown'.",
  "facial_features": "A brief summary of defining features, e.g., 'high cheekbones, strong jawline'."
}
\`\`\``;

const qaCheckSystemPrompt = `You are a meticulous Quality Assurance AI for a photorealistic model generation pipeline. You will be given a "BASE MODEL" image, a "GENERATED POSE" image, and the "TEXT PROMPT" used to create it. Your task is to perform a comprehensive analysis and return a single JSON object with your findings.

### Part 1: Anatomical & Pose Integrity
- Does the GENERATED POSE have the correct number of limbs and a realistic human anatomy?
- Does the pose accurately reflect the instructions in the TEXT PROMPT?

### Part 2: Identity Preservation
- Compare the GENERATED POSE to the BASE MODEL. Has the model's identity been preserved?
- Specifically check for significant changes in **skin tone**, facial structure, and hair style/color.

### Part 3: Garment Analysis
- Analyze the garment worn in the GENERATED POSE. Determine its \`coverage\` ('upper_body', 'lower_body', 'full_body') and if it is a new garment (\`is_identical_to_base_garment: false\`).

### Your Final Output:
Based on your analysis, return a JSON object with the following structure:
\`\`\`json
{
  "qa_status": "pass" | "fail",
  "reasoning": "A brief, clear explanation for your decision.",
  "failure_modes": ["anatomical_error", "pose_mismatch", "skin_tone_mismatch", "identity_drift"],
  "garment_analysis": {
    "description": "A description of the garment worn.",
    "coverage": "upper_body" | "lower_body" | "full_body",
    "is_identical_to_base_garment": boolean
  }
}
\`\`\`
- Set \`qa_status\` to \`pass\` only if BOTH anatomical integrity and identity preservation are successful.
- If \`qa_status\` is \`fail\`, populate the \`failure_modes\` array with all applicable reasons.`;

function extractJson(text: any) {
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (match && match[1]) return JSON.parse(match[1]);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("The model returned a response that could not be parsed as JSON.");
  }
}

async function downloadImageAsPart(supabase: any, publicUrl: string) {
  const url = new URL(publicUrl);
  const pathSegments = url.pathname.split('/');
  const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
  const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
  const { data, error } = await supabase.storage.from(bucketName).download(filePath);
  if (error) throw new Error(`Failed to download image from storage: ${error.message}`);
  const buffer = await data.arrayBuffer();
  const base64 = encodeBase64(buffer);
  return [{
    inlineData: {
      mimeType: data.type,
      data: base64
    }
  }];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id, image_url, base_model_image_url, pose_prompt } = await req.json();
  if (!job_id || !base_model_image_url) {
    throw new Error("job_id and base_model_image_url are required for all analysis tasks.");
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
  const logPrefix = `[PoseAnalyzer][${job_id}]`;

  // --- ROUTER LOGIC ---
  if (image_url && pose_prompt) {
    // QA Check Mode
    await performQACheck(supabase, ai, logPrefix, { job_id, image_url, base_model_image_url, pose_prompt });
  } else {
    // Identity Passport Mode
    await createIdentityPassport(supabase, ai, logPrefix, { job_id, base_model_image_url });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200
  });
});

async function createIdentityPassport(supabase: any, ai: GoogleGenAI, logPrefix: string, { job_id, base_model_image_url }: any) {
  console.log(`${logPrefix} Running in 'Identity Passport' creation mode.`);
  try {
    const baseModelImageParts = await downloadImageAsPart(supabase, base_model_image_url);
    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [{ role: 'user', parts: baseModelImageParts }],
      generationConfig: { responseMimeType: "application/json" },
      config: { systemInstruction: { role: "system", parts: [{ text: identityPassportSystemPrompt }] } }
    });

    const passport = extractJson(result.text);
    console.log(`${logPrefix} Identity Passport created:`, JSON.stringify(passport));

    const { data: job, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('metadata').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const { error: updateError } = await supabase.from('mira-agent-model-generation-jobs').update({
      metadata: { ...job.metadata, identity_passport: passport }
    }).eq('id', job_id);
    if (updateError) throw updateError;

    console.log(`${logPrefix} Successfully saved Identity Passport to job metadata.`);
  } catch (error) {
    console.error(`${logPrefix} Error creating Identity Passport:`, error);
    // We don't fail the main job here, but log the error. The process can continue without it.
  }
}

async function performQACheck(supabase: any, ai: GoogleGenAI, logPrefix: string, { job_id, image_url, base_model_image_url, pose_prompt }: any) {
  console.log(`${logPrefix} Running in 'QA Check' mode for pose: "${pose_prompt}"`);
  try {
    const [poseImageParts, baseModelImageParts] = await Promise.all([
      downloadImageAsPart(supabase, image_url),
      downloadImageAsPart(supabase, base_model_image_url)
    ]);

    const finalParts = [
      { text: "--- BASE MODEL ---" }, ...baseModelImageParts,
      { text: "--- GENERATED POSE ---" }, ...poseImageParts,
      { text: `--- TEXT PROMPT --- \n${pose_prompt}` }
    ];

    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [{ role: 'user', parts: finalParts }],
      generationConfig: { responseMimeType: "application/json" },
      config: { systemInstruction: { role: "system", parts: [{ text: qaCheckSystemPrompt }] } }
    });

    const analysisResult = extractJson(result.text);
    console.log(`${logPrefix} QA Analysis complete:`, JSON.stringify(analysisResult));

    const { data: job, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('final_posed_images').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const updatedPoses = (job.final_posed_images || []).map((pose: any) => {
      if (pose.final_url === image_url) {
        return {
          ...pose,
          status: analysisResult.qa_status === 'pass' ? 'complete' : 'failed',
          analysis: analysisResult
        };
      }
      return pose;
    });

    const { error: updateError } = await supabase.from('mira-agent-model-generation-jobs').update({
      final_posed_images: updatedPoses
    }).eq('id', job_id);
    if (updateError) throw updateError;

    console.log(`${logPrefix} Successfully saved QA report and updated pose status.`);
  } catch (error) {
    console.error(`${logPrefix} Error performing QA check:`, error);
    // Attempt to mark the pose as failed so it doesn't get stuck in 'analyzing'
    try {
      const { data: job, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('final_posed_images').eq('id', job_id).single();
      if (!fetchError && job) {
        const updatedPoses = (job.final_posed_images || []).map((pose: any) => {
          if (pose.final_url === image_url) {
            return { ...pose, status: 'failed', error_message: `Analysis failed: ${error.message}` };
          }
          return pose;
        });
        await supabase.from('mira-agent-model-generation-jobs').update({ final_posed_images: updatedPoses }).eq('id', job_id);
      }
    } catch (updateErr) {
      console.error(`${logPrefix} Failed to mark pose as failed after an error:`, updateErr);
    }
  }
}