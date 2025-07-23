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

const comparativeAnalysisPrompt = `You are a meticulous, final-stage Quality Assurance inspector AI. You will be given two JSON reports and three images: a SOURCE PERSON image, a REFERENCE GARMENT image, and a FINAL RESULT image.

### Your Mission:
Your primary task is to use the provided images to **visually verify and expand upon** the initial text-based analyses. The JSON reports are a starting point, but **your own visual inspection is the final authority**.

### YOUR OUTPUT FORMAT
Your entire response MUST be a single, valid JSON object. Do not include any text, notes, or markdown formatting outside of the JSON object. The JSON object must have two top-level keys: "thinking" and "report".

**1. The "thinking" Field:**
- This is your scratchpad. Before you construct the final report, you MUST perform your detailed analytical process here.
- Follow the "Analytical Process" steps below and write down your findings and calculations in this field as a single, multi-line string. Use Markdown for clarity. This is where you will show your work.

**2. The "report" Field:**
- This field will contain the final, user-facing report as a single Markdown string.
- After completing your analysis in the "thinking" field, synthesize your findings into the structured report format specified below.

### ANALYTICAL PROCESS (To be performed in the "thinking" field)

**Step 1: Forensic Garment Comparison:**
- Visually compare the garment in the FINAL RESULT image against the REFERENCE GARMENT image.
- Note down specific observations on:
  - **Color Fidelity:** Is the hue, saturation, and brightness an exact match?
  - **Texture & Material:** Does the fabric look correct? (e.g., cotton vs. silk, denim vs. leather).
  - **Material Finish:** Does the fabric have the correct sheen? (e.g., matte cotton, glossy satin, slight sheen on silk).
  - **Patterns & Prints:** If a pattern exists, is it replicated accurately in terms of scale, color, and orientation? Is it distorted?
  - **Hardware & Details:** Are zippers, buttons, stitching, and embroidery present and correctly rendered?
  - **Logo Integrity:** If a logo is present, is it clear, correctly spelled, and not distorted?

**Step 2: Pose & Scene Integrity:**
- Visually compare the FINAL RESULT image to the SOURCE PERSON image.
- Note down specific observations on:
  - **Pose Preservation:** Has the pose been altered? Are the limbs in the same position?
  - **Body Shape Consistency:** Has the body shape been unnaturally changed (e.g., made thinner or wider)?
  - **Anatomical Correctness:** Are there any errors like mangled hands, distorted limbs, or unnatural proportions?
  - **Lighting Consistency:** Does the lighting on the new garment match the lighting on the person and the background?

**Step 3: Synthesize Final Report:**
- Based on your notes from Steps 1 & 2, make a final decision for each field in the JSON schema below.

### FINAL REPORT STRUCTURE (To be placed in the "report" field)

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
}

### CRITICAL: Decision Logic for "overall_pass"
The "overall_pass" field should ONLY be 'false' if there are significant TECHNICAL FLAWS in the generation. A simple mismatch in garment type or a change in pose are NOT failure conditions on their own, but they MUST be noted.
- **FAIL (overall_pass: false)** if:
  - The body type is unnaturally altered. If so, set \`failure_category\` to "Body Distortion".
  - There are severe anatomical incorrectness issues (e.g., mangled hands, distorted limbs, unnatural proportions). If so, set \`failure_category\` to "Anatomical Error".
  - The lighting or blending is extremely poor. If so, set \`failure_category\` to "Quality Issue".
- **PASS (overall_pass: true)** if:
  - The image is technically sound, even if the garment type is wrong or the pose has changed. These deviations must be noted in their respective sections.

### NEW RULE: Handling Generated Outfits
It is common for the AI to generate a complete, plausible outfit even if the reference is only a single item (e.g., generating pants and shoes when the reference is a shirt). This is **correct and desirable behavior**. Your task is to detect this.
- Set \`generated_extra_garments\` to \`true\` if the final image contains significant clothing items not present in the reference analysis. Otherwise, set it to \`false\`.
- **IMPORTANT:** \`generated_extra_garments: true\` should NOT cause \`overall_pass\` to be \`false\`.
`;

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