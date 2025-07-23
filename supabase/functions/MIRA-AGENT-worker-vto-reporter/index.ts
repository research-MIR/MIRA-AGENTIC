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

const comparativeAnalysisPrompt = `You are a senior Quality Assurance inspector AI. You will be given a JSON object describing a REFERENCE garment, a JSON object describing a FINAL garment, and the original person's image. Your task is to compare them and produce a final QA report.

### Instructions:
1.  Compare the 'final_analysis' against the 'reference_analysis' to determine accuracy.
2.  Analyze the original person's image to assess pose and scene characteristics.
3.  Your entire response MUST be a single, valid JSON object.

### CRITICAL: Decision Logic for "overall_pass"
The "overall_pass" field should ONLY be 'false' if there are significant TECHNICAL FLAWS in the generation. A simple mismatch in garment type is NOT a failure condition on its own, but it MUST be noted.
- **FAIL (overall_pass: false)** if:
  - The pose is significantly changed or distorted.
  - The body type is unnaturally altered.
  - There are severe anatomical incorrectness issues (e.g., mangled hands).
  - The lighting or blending is extremely poor.
- **PASS (overall_pass: true)** if:
  - The image is technically sound, even if the garment type is wrong. For example, if the reference was a t-shirt but the AI generated a high-quality, realistic jacket, this is a PASS, but the 'garment_comparison.type_match' must be 'false'.

### Rules for 'pose_complexity':
-   **standard A-pose**: Standing straight, facing camera, arms relaxed at sides.
-   **casual standing**: Standing with minor variations (hands on hips, slight turn). Limbs are mostly visible.
-   **dynamic/action**: Involves clear movement (walking, jumping, arms raised).
-   **seated**: The model is sitting on any surface.

### JSON Schema:
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
    "notes": "string"
  },
  "pose_and_body_analysis": {
    "original_pose_description": "string",
    "original_camera_angle": {
        "shot_type": "string",
        "camera_elevation": "string",
        "camera_position": "string"
    },
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

    console.log(`${logPrefix} Stage 2: Performing comparative analysis...`);
    const personImageParts = await downloadImageAsPart(supabase, vtoJob.source_person_image_url, "SOURCE PERSON");
    const comparisonParts: Part[] = [
        { text: "--- REFERENCE GARMENT ANALYSIS (JSON) ---" },
        { text: JSON.stringify(reference_garment_analysis) },
        { text: "--- FINAL RESULT ANALYSIS (JSON) ---" },
        { text: JSON.stringify(final_result_analysis) },
        { text: "--- ORIGINAL PERSON IMAGE ---" },
        ...personImageParts
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