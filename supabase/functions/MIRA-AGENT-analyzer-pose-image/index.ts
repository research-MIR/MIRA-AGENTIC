import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest"; // Using a fast model for analysis
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Quality Assurance AI" for a photorealistic model generation pipeline. You will be given two images: a "BASE MODEL" image (showing the model in neutral underwear) and a "GENERATED POSE" image. Your sole task is to analyze the "GENERATED POSE" and return a structured JSON object.

### Task 1: Shoot Focus Analysis
Analyze the framing of the "GENERATED POSE" image to determine the shoot focus. You MUST use the following logic:
1.  Could at least 40% of a typical upper-body garment (like a t-shirt or blazer) be visible in this shot?
2.  If NO, the shoot focus is **"lower_body"**.
3.  If YES, then ask: Could at least 40% of a typical lower-body garment (like trousers or a skirt) be visible?
4.  If NO, the shoot focus is **"upper_body"**.
5.  If YES to both questions, the shoot focus is **"full_body"**.

### Task 2: Garment Analysis
1.  Identify the primary garment the model is wearing in the "GENERATED POSE" image (e.g., "simple grey bra," "blue denim jacket").
2.  Classify the body part that this garment covers. The value MUST be one of: **"upper_body"**, **"lower_body"**, or **"full_body"**.

### Task 3: Visual Comparison (CRITICAL)
You must perform a direct visual comparison. Is the garment worn in the "GENERATED POSE" image the **exact, identical, pixel-for-pixel same garment** as the one worn in the "BASE MODEL" image? Your answer for the \`is_identical_to_base_garment\` field must be a boolean (\`true\` or \`false\`). Be extremely strict. Any change in color, shape, texture, or style means it is not identical.

### Output Format
Your entire response MUST be a single, valid JSON object with the following structure. Do not include any other text or explanations.

{
  "shoot_focus": "upper_body" | "lower_body" | "full_body",
  "garment": {
    "description": "A concise text description of the garment.",
    "coverage": "upper_body" | "lower_body" | "full_body",
    "is_identical_to_base_garment": true | false
  }
}`;

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

async function downloadImageAsPart(supabase: SupabaseClient, publicUrl: string): Promise<Part[]> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download image from storage: ${error.message}`);
    const buffer = await data.arrayBuffer();
    const base64 = encodeBase64(buffer);
    return [{ inlineData: { mimeType: data.type, data: base64 } }];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id, image_url, base_model_image_url, pose_prompt } = await req.json();
  if (!job_id || !image_url || !base_model_image_url || !pose_prompt) {
    throw new Error("job_id, image_url, base_model_image_url, and pose_prompt are required.");
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[PoseAnalyzer][${job_id}]`;
  console.log(`${logPrefix} Analyzing pose: "${pose_prompt}"`);

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    
    const [poseImageParts, baseModelImageParts] = await Promise.all([
        downloadImageAsPart(supabase, image_url),
        downloadImageAsPart(supabase, base_model_image_url)
    ]);

    const finalParts: Part[] = [
        { text: "--- BASE MODEL ---" },
        ...baseModelImageParts,
        { text: "--- GENERATED POSE ---" },
        ...poseImageParts
    ];
    
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: finalParts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const analysisResult = extractJson(result.text);
    console.log(`${logPrefix} Analysis complete:`, JSON.stringify(analysisResult));

    // Fetch the job, update the specific pose, and save it back
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .select('final_posed_images')
      .eq('id', job_id)
      .single();

    if (fetchError) throw fetchError;

    const updatedPoses = (job.final_posed_images || []).map((pose: any) => {
      if (pose.final_url === image_url) {
        return {
          ...pose,
          status: 'complete',
          analysis: analysisResult,
        };
      }
      return pose;
    });

    const { error: updateError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .update({ final_posed_images: updatedPoses })
      .eq('id', job_id);

    if (updateError) throw updateError;

    console.log(`${logPrefix} Successfully saved analysis to job.`);
    return new Response(JSON.stringify({ success: true, analysis: analysisResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
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
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});