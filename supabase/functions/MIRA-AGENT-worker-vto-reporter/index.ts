import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const garmentAnalysisPrompt = `You are a forensic fashion analyst AI. Your task is to analyze the provided image and extract a detailed, structured description of the primary garment.

### Instructions:
1.  Identify the single main garment worn by the person.
2.  Analyze its visual properties with extreme precision based on the provided rules.
3.  Your entire response MUST be a single, valid JSON object.

### Rules for 'garment_complexity':
-   **simple**: Basic silhouette (t-shirt, leggings), uniform texture (cotton, denim), solid color or simple pattern.
-   **moderate**: Tailored elements (blazer, trousers), subtle textures (silk, leather), or moderately complex patterns (plaid, florals).
-   **complex**: Intricate construction (draping, ruching), challenging textures (lace, sheer fabrics, sequins, heavy embroidery), or fine, non-repeating graphic prints.

### JSON Schema:
{
  "garment_type": "string",
  "primary_color": "string",
  "material_texture": "string",
  "pattern_analysis": {
    "has_pattern": "boolean",
    "pattern_type": "string | null",
    "pattern_description": "string | null"
  },
  "details": ["string"],
  "complexity": "string"
}`;

const comparativeAnalysisPrompt = `You are a meticulous, final-stage Quality Assurance inspector AI acting as a "Forensic Scientist". You will be given two JSON reports and three images: a SOURCE PERSON image, a REFERENCE GARMENT image, and a FINAL RESULT image.

### Your Mission:
Your primary task is to use the provided images to **visually verify and expand upon** the initial text-based analyses. The JSON reports are a starting point, but **your own visual inspection is the final authority**.

### Your Process:
1.  **Forensic Garment Comparison:** Visually compare the garment in the FINAL RESULT image against the REFERENCE GARMENT image. This is your most critical task.
    -   **Fidelity Check:** Is it the *exact same garment*? Scrutinize color fidelity, texture, material sheen, pattern scale and accuracy, and details like stitching, buttons, or logos.
    -   **Note Discrepancies:** If it's not an exact match, your notes must be specific (e.g., "The generated jacket is a lighter shade of blue and is missing the reference's silver zipper pulls.").
2.  **Pose & Scene Integrity:** Compare the FINAL RESULT image to the SOURCE PERSON image.
    -   Has the pose been altered?
    -   Has the body shape been unnaturally changed?
    -   Is the lighting consistent?
    -   Are there anatomical errors (mangled hands, distorted limbs, unnatural proportions)?
3.  **Synthesize Final Report:** Based on your direct visual analysis, generate the final JSON report.

### CRITICAL: Decision Logic for "overall_pass"
The "overall_pass" field should ONLY be 'false' if there are significant TECHNICAL FLAWS in the generation. A simple mismatch in garment type or a change in pose are NOT failure conditions on their own, but they MUST be noted.
- **FAIL (overall_pass: false)** if:
  - The body type is unnaturally altered. If so, set \`failure_category\` to "Body Distortion".
  - There are severe anatomical incorrectness issues (e.g., mangled hands, distorted limbs, unnatural proportions). If so, set \`failure_category\` to "Anatomical Error".
  - The lighting or blending is extremely poor. If so, set \`failure_category\` to "Quality Issue".
- **PASS (overall_pass: true)** if:
  - The image is technically sound, even if the garment type is wrong or the pose has changed. These deviations must be noted in their respective sections.

### NEW RULE: Handling Generated Outfits
It is common for the AI to generate a complete, plausible outfit even if the reference is only a single item (e.g., generating a matching top and shoes when the reference is a skirt). This is **correct and desirable creative behavior**.
1.  Set \`generated_extra_garments\` to \`true\` if the final image contains significant, *separate* clothing items not present in the reference analysis.
2.  If \`true\`, you MUST populate the \`extra_garments_list\` with a short description of each additional item (e.g., "matching top", "heeled shoes").
3.  **IMPORTANT:** \`generated_extra_garments: true\` should NOT cause \`overall_pass\` to be \`false\`. It is a creative success, not a failure. Differentiate between generating a *different* garment (e.g., a dress instead of a skirt, which would make \`type_match: false\`) and generating *additional* garments.

### JSON Schema (Your Output):
{
  "overall_pass": "boolean",
  "confidence_score": "number",
  "failure_category": "string | null",
  "mismatch_reason": "string | null",
  "garment_comparison": {
    "type_match": "boolean",
    "color_match": "boolean",
    "pattern_match": "boolean",
    "fit_match": "boolean",
    "generated_extra_garments": "boolean",
    "extra_garments_list": ["string"],
    "notes": "string"
  },
  "pose_and_body_analysis": {
    "original_pose_description": "string",
    "original_camera_angle": { "shot_type": "string", "camera_elevation": "string", "camera_position": "string" },
    "pose_changed": "boolean",
    "camera_angle_changed": "boolean",
    "body_type_changed": "boolean",
    "affected_body_parts": ["string"],
    "notes": "string"
  },
  "quality_analysis": {
      "anatomical_correctness": "boolean",
      "lighting_match": "boolean",
      "blending_quality": "string",
      "notes": "string | null"
  }
}`;

const extractJson = (text: string): any => {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
};

const downloadImageAsPart = async (supabase: SupabaseClient, url: string, label: string): Promise<Part[]> => {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download ${label}: ${error.message}`);
    const buffer = await data.arrayBuffer();
    const base64 = encodeBase64(buffer);
    return [{ inlineData: { mimeType: data.type, data: base64 } }];
};

const analyzeGarment = async (ai: GoogleGenAI, supabase: SupabaseClient, imageUrl: string, label: string): Promise<any> => {
    const imageParts = await downloadImageAsPart(supabase, imageUrl, label);
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: imageParts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: garmentAnalysisPrompt }] } }
    });
    return extractJson(result.text);
};

serve(async (req) => {
  const { qa_job_id } = await req.json();
  if (!qa_job_id) throw new Error("qa_job_id is required.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-QA-Worker][${qa_job_id}]`;
  console.log(`${logPrefix} Worker invoked.`);

  try {
    await supabase.from('mira-agent-vto-qa-reports').update({ status: 'processing' }).eq('id', qa_job_id);

    const { data: qaJob, error: qaFetchError } = await supabase.from('mira-agent-vto-qa-reports').select('source_vto_job_id').eq('id', qa_job_id).single();
    if (qaFetchError) throw qaFetchError;

    const { data: vtoJob, error: vtoFetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('source_person_image_url, source_garment_image_url, final_image_url').eq('id', qaJob.source_vto_job_id).single();
    if (vtoFetchError) throw vtoFetchError;
    if (!vtoJob.final_image_url) throw new Error("VTO job is missing a final_image_url.");

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });

    console.log(`${logPrefix} Stage 1: Analyzing images independently...`);
    const [reference_garment_analysis, final_result_analysis] = await Promise.all([
        analyzeGarment(ai, supabase, vtoJob.source_garment_image_url, "REFERENCE GARMENT"),
        analyzeGarment(ai, supabase, vtoJob.final_image_url, "FINAL RESULT")
    ]);
    await supabase.from('mira-agent-vto-qa-reports').update({ reference_garment_analysis, final_result_analysis }).eq('id', qa_job_id);
    console.log(`${logPrefix} Stage 1 complete.`);

    console.log(`${logPrefix} Stage 2: Performing comparative analysis with all visual evidence...`);
    const [personImageParts, referenceGarmentParts, finalResultParts] = await Promise.all([
        downloadImageAsPart(supabase, vtoJob.source_person_image_url, "SOURCE PERSON"),
        downloadImageAsPart(supabase, vtoJob.source_garment_image_url, "REFERENCE GARMENT"),
        downloadImageAsPart(supabase, vtoJob.final_image_url, "FINAL RESULT")
    ]);

    const comparisonParts: Part[] = [
        { text: "--- REFERENCE GARMENT ANALYSIS (JSON) ---" },
        { text: JSON.stringify(reference_garment_analysis) },
        { text: "--- FINAL RESULT ANALYSIS (JSON) ---" },
        { text: JSON.stringify(final_result_analysis) },
        { text: "--- SOURCE PERSON IMAGE ---" },
        ...personImageParts,
        { text: "--- REFERENCE GARMENT IMAGE ---" },
        ...referenceGarmentParts,
        { text: "--- FINAL RESULT IMAGE ---" },
        ...finalResultParts
    ];
    const comparisonResult = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: comparisonParts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: comparativeAnalysisPrompt }] } }
    });
    const comparative_report = extractJson(comparisonResult.text);
    console.log(`${logPrefix} Stage 2 complete.`);

    await supabase.from('mira-agent-vto-qa-reports').update({ comparative_report, status: 'complete' }).eq('id', qa_job_id);
    await supabase.from('mira-agent-bitstudio-jobs').update({ metadata: { verification_result: comparative_report } }).eq('id', qaJob.source_vto_job_id);
    console.log(`${logPrefix} Job finished successfully.`);

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-vto-qa-reports').update({ status: 'failed', error_message: error.message }).eq('id', qa_job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});