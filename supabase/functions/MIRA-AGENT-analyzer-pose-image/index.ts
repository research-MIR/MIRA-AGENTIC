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

const systemPrompt = `You are a "Quality Assurance AI" for a photorealistic model generation pipeline. You will be given a user's creative brief and four images of the same human model, labeled "Image 0", "Image 1", "Image 2", and "Image 3". Your sole task is to evaluate them and choose the single best one that matches the brief, and identify the model's gender.

### Evaluation Criteria (in order of importance):
1.  **Pose Compliance (Highest Priority):** The model MUST be in a neutral, frontal, standing A-pose with arms relaxed at the sides and a neutral facial expression. Reject any image with a dynamic, angled, or expressive pose, even if it is otherwise high quality. The goal is a clean, standard e-commerce base model.
2.  **Prompt Coherence:** Does the model in the image accurately reflect the user's 'Model Description'? (e.g., if the user asked for "long blonde hair," does the model have it?).
3.  **Anatomical Correctness:** The model must have realistic human anatomy. Check for common AI errors like incorrect hands, distorted limbs, or unnatural facial features. Reject any image with clear anatomical flaws.
4.  **Photorealism:** The image should look like a real photograph. Assess the skin texture, lighting, and overall quality.
5.  **Aesthetic Appeal (Tie-breaker only):** If multiple images perfectly satisfy all the above criteria, use general aesthetic appeal as the final deciding factor.

### Gender Identification:
After selecting the best image, you MUST identify the gender of the model. The value must be one of two strings: "male" or "female".

### Your Output:
Your entire response MUST be a single, valid JSON object with TWO keys: "best_image_index" and "gender".

**Example Output:**
\`\`\`json
{
  "best_image_index": 2,
  "gender": "female"
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