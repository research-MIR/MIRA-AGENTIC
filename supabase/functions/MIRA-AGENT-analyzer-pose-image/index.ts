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
const systemPrompt = `You are a "Quality Assurance AI" for a photorealistic model generation pipeline. You will be given two images: a "BASE MODEL" image (showing the model in neutral underwear) and a "GENERATED POSE" image. Your sole task is to analyze the "GENERATED POSE" and return a structured JSON object.

### Your Internal Thought Process (Chain-of-Thought)
You MUST follow these steps in order to produce the correct output.

#### Task 1: Shoot Focus Analysis
Analyze the framing of the "GENERATED POSE" image to determine the shoot focus.
- **Rule:** If the model's head and feet are both visible (or would be, if not cut off by the frame), the focus is **'full_body'**.
- **Rule:** If the shot is from the waist up and the legs are not visible, the focus is **'upper_body'**.
- **Rule:** If the shot is from the hips down and the face is not visible, the focus is **'lower_body'**.
- **Edge Case:** A sitting pose where legs are visible is considered **'full_body'**.

#### Task 2: Garment Analysis (Revised Logic)
This is a hierarchical process. You MUST follow these steps in order.
1.  **Identify All Garments:** First, identify every clothing item the model is wearing in the "GENERATED POSE" image.
2.  **Prioritize New Fashion Items:** Check if the model is wearing any garment that is NOT the base underwear (i.e., a garment where \`is_identical_to_base_garment\` would be \`false\`).
    -   **If YES:** The \`coverage\` for the entire pose MUST be determined by this new fashion item.
        -   **The Fundamental Type Rule:** You must classify the garment by its fundamental type, not its styling. A very long t-shirt is still an 'upper_body' garment, not a 'full_body' dress. A long jacket is still 'upper_body'.
        -   If there are multiple new fashion items (e.g., a new shirt and new pants), you MUST classify the coverage as 'full_body'.
    -   **If NO:** The model is only wearing the base underwear (and possibly accessories/shoes). In this case, and ONLY in this case, the \`coverage\` is 'full_body'.
3.  **Accessory/Shoe Exclusion:** As before, accessories (hats, bags, scarves) and shoes do not influence the \`coverage\` calculation. The coverage is determined by the main clothing items (shirt, pants, dress, underwear).
4.  **Final \`coverage\` Value:** The final value for \`coverage\` MUST be one of: **'upper_body'**, **'lower_body'**, or **'full_body'**.

#### Task 3: Visual Comparison (CRITICAL)
Is the garment worn in the "GENERATED POSE" image functionally and stylistically the same as the base underwear in the "BASE MODEL" image?
- **Rule:** Ignore minor variations in lighting, shadow, or subtle fabric wrinkles that are a natural result of a different pose.
- **Rule:** The garment is only considered different (i.e., \`is_identical_to_base_garment: false\`) if it is a distinct, new clothing item (e.g., a t-shirt, a jacket, jeans, a dress).

### Output Format
Your entire response MUST be a single, valid JSON object with the following structure. Do not include any other text or explanations.

### Few-Shot Examples

**Example 1: Long T-shirt (Fundamental Type Rule)**
- **Context:** The "GENERATED POSE" image shows a model wearing a very long t-shirt that covers their thighs, but no pants.
- **Correct Logic:** A t-shirt is fundamentally an 'upper_body' garment, regardless of its length.
- **Correct Output Snippet:**
  \`\`\`json
  {
    "garment": {
      "description": "A long, oversized white t-shirt.",
      "coverage": "upper_body",
      "is_identical_to_base_garment": false
    }
  }
  \`\`\`

**Example 2: Jacket over Base Underwear (Prioritization Hierarchy)**
- **Context:** The "GENERATED POSE" image shows a model wearing a leather jacket over their base underwear.
- **Correct Logic:** A new fashion item (the jacket) is present. Its coverage (\`upper_body\`) takes priority over the base underwear's coverage.
- **Correct Output Snippet:**
  \`\`\`json
  {
    "garment": {
      "description": "A black leather jacket and simple grey underwear.",
      "coverage": "upper_body",
      "is_identical_to_base_garment": false
    }
  }
  \`\`\`
`;
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
  return [
    {
      inlineData: {
        mimeType: data.type,
        data: base64
      }
    }
  ];
}
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  const { job_id, image_url, base_model_image_url, pose_prompt } = await req.json();
  if (!job_id || !image_url || !base_model_image_url || !pose_prompt) {
    throw new Error("job_id, image_url, base_model_image_url, and pose_prompt are required.");
  }
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[PoseAnalyzer][${job_id}]`;
  console.log(`${logPrefix} Analyzing pose: "${pose_prompt}"`);
  try {
    const ai = new GoogleGenAI({
      apiKey: GEMINI_API_KEY
    });
    const [poseImageParts, baseModelImageParts] = await Promise.all([
      downloadImageAsPart(supabase, image_url),
      downloadImageAsPart(supabase, base_model_image_url)
    ]);
    const finalParts = [
      {
        text: "--- BASE MODEL ---"
      },
      ...baseModelImageParts,
      {
        text: "--- GENERATED POSE ---"
      },
      ...poseImageParts
    ];
    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: [
        {
          role: 'user',
          parts: finalParts
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      },
      config: {
        systemInstruction: {
          role: "system",
          parts: [
            {
              text: systemPrompt
            }
          ]
        }
      }
    });
    const analysisResult = extractJson(result.text);
    console.log(`${logPrefix} Analysis complete:`, JSON.stringify(analysisResult));
    // Fetch the job, update the specific pose, and save it back
    const { data: job, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('final_posed_images').eq('id', job_id).single();
    if (fetchError) throw fetchError;
    const updatedPoses = (job.final_posed_images || []).map((pose: any)=>{
      if (pose.final_url === image_url) {
        return {
          ...pose,
          status: 'complete',
          analysis: analysisResult
        };
      }
      return pose;
    });
    const { error: updateError } = await supabase.from('mira-agent-model-generation-jobs').update({
      final_posed_images: updatedPoses
    }).eq('id', job_id);
    if (updateError) throw updateError;
    console.log(`${logPrefix} Successfully saved analysis to job.`);
    return new Response(JSON.stringify({
      success: true,
      analysis: analysisResult
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    // Attempt to mark the pose as failed so it doesn't get stuck in 'analyzing'
    try {
      const { data: job, error: fetchError } = await supabase.from('mira-agent-model-generation-jobs').select('final_posed_images').eq('id', job_id).single();
      if (!fetchError && job) {
        const updatedPoses = (job.final_posed_images || []).map((pose: any)=>{
          if (pose.final_url === image_url) {
            return {
              ...pose,
              status: 'failed',
              error_message: `Analysis failed: ${error.message}`
            };
          }
          return pose;
        });
        await supabase.from('mira-agent-model-generation-jobs').update({
          final_posed_images: updatedPoses
        }).eq('id', job_id);
      }
    } catch (updateErr) {
      console.error(`${logPrefix} Failed to mark pose as failed after an error:`, updateErr);
    }
    return new Response(JSON.stringify({
      error: error.message
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});