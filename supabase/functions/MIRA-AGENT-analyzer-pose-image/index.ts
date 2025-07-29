import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest"; // Using a fast model for analysis
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert fashion and photography analyst AI. You will be given two images: a "BASE MODEL" and a "GENERATED POSE". Your task is to analyze the "GENERATED POSE" image and provide a structured JSON analysis.

### Your Analysis Process:
1.  **Shoot Focus:** Determine the camera framing of the "GENERATED POSE". It MUST be one of these exact string values: **'full_body'**, **'upper_body'**, or **'lower_body'**.
2.  **Garment Analysis:**
    -   Describe the garment(s) the model is wearing in the "GENERATED POSE".
    -   Determine the primary coverage of the garment(s). It MUST be one of these exact string values: **'full_body'**, **'upper_body'**, **'lower_body'**, or **'shoes'**.
3.  **Visual Comparison:** Critically compare the garment in the "GENERATED POSE" to the simple grey underwear worn by the "BASE MODEL". Determine if they are the exact same garment.

### Your Output:
Your entire response MUST be a single, valid JSON object with the following structure. Do not include any other text or explanations.

\`\`\`json
{
  "shoot_focus": "full_body",
  "garment": {
    "description": "A detailed description of the garment(s) worn in the GENERATED POSE.",
    "coverage": "upper_body",
    "is_identical_to_base_garment": false
  }
}
\`\`\`
`;

async function downloadImageAsPart(supabase: SupabaseClient, publicUrl: string, label: string): Promise<Part[]> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Could not parse bucket name from Supabase URL: ${publicUrl}`);
    }
    
    const bucketName = pathSegments[objectSegmentIndex + 2];
    const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));

    if (!bucketName || !filePath) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage.from(bucketName).download(filePath);
    if (downloadError) throw new Error(`Supabase download failed for ${label}: ${downloadError.message}`);

    const mimeType = fileBlob.type;
    const buffer = await fileBlob.arrayBuffer();
    const base64 = encodeBase64(buffer);

    return [{ text: `--- ${label} ---` }, { inlineData: { mimeType, data: base64 } }];
}

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { job_id, image_url, base_model_image_url, pose_prompt } = await req.json();
  if (!job_id || !image_url || !base_model_image_url || !pose_prompt) {
    throw new Error("job_id, image_url, base_model_image_url, and pose_prompt are required.");
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[PoseAnalyzer][${job_id}]`;
  const isBasePoseAnalysis = image_url === base_model_image_url;

  if (isBasePoseAnalysis) {
    console.log(`${logPrefix} [BASE POSE ANALYSIS] Starting analysis for base A-pose model.`);
  } else {
    console.log(`${logPrefix} Analyzing pose: "${pose_prompt}"`);
  }

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    
    const [poseImageParts, baseModelImageParts] = await Promise.all([
        downloadImageAsPart(supabase, image_url, "GENERATED POSE"),
        downloadImageAsPart(supabase, base_model_image_url, "BASE MODEL")
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
    if (isBasePoseAnalysis) {
        console.log(`${logPrefix} [BASE POSE ANALYSIS] Analysis complete. Result:`, JSON.stringify(analysisResult));
    } else {
        console.log(`${logPrefix} Analysis complete:`, JSON.stringify(analysisResult));
    }

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

    if (isBasePoseAnalysis) {
        console.log(`${logPrefix} [BASE POSE ANALYSIS] Successfully saved analysis to job.`);
    } else {
        console.log(`${logPrefix} Successfully saved analysis to job.`);
    }
    return new Response(JSON.stringify({ success: true, analysis: analysisResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    if (isBasePoseAnalysis) {
        console.error(`${logPrefix} [BASE POSE ANALYSIS] Error:`, error);
    } else {
        console.error(`${logPrefix} Error:`, error);
    }
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