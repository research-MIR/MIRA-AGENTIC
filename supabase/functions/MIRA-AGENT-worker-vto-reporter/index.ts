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
Your primary task is to perform a deep, quantitative analysis and produce a structured JSON report. Your own visual inspection is the final authority.

### YOUR OUTPUT FORMAT
Your entire response MUST be a single, valid JSON object with two top-level keys: "thinking" and "report".

**1. The "thinking" Field:**
- This is your scratchpad. Before you construct the final report, you MUST perform your detailed analytical process here. Write down your step-by-step reasoning, observations, and score justifications in this field as a single, multi-line string.

**2. The "report" Field:**
- This field will contain the final, structured JSON report. After completing your analysis in the "thinking" field, synthesize your findings into the structured report format specified in the schema below.

### ANALYTICAL PROCESS (To be performed in the "thinking" field)

1.  **Forensic Garment Comparison:** Visually compare the garment in the FINAL RESULT against the REFERENCE GARMENT.
    -   **Color Fidelity:** How close is the color? (1-10 score)
    -   **Texture Realism:** Does the material look authentic? (1-10 score)
    -   **Pattern Accuracy:** Is the pattern correctly replicated in scale and detail? (1-10 score)
    -   **Fit & Shape:** Does the generated garment have the correct silhouette and fit? (1-10 score)
    -   **Detail Fidelity:** Identify key details (zippers, buttons, logos) from the reference. For each, determine if it was matched, simplified, altered, or is missing in the final result.
2.  **Pose & Scene Integrity:** Compare the FINAL RESULT to the SOURCE PERSON.
    -   **Pose Preservation:** How well was the original pose maintained? (1-10 score)
    -   **Anatomical Correctness:** Are there any anatomical errors (mangled hands, distorted limbs)? (1-10 score)
3.  **Synthesize Final Report:** Based on your analysis, construct the final JSON report.

### CRITICAL: Decision Logic for "overall_pass"
- **FAIL (overall_pass: false)** if:
  - The body type is unnaturally altered (\`failure_category\`: "Body Distortion").
  - There are severe anatomical errors (\`failure_category\`: "Anatomical Error").
  - The lighting or blending is extremely poor (\`failure_category\`: "Quality Issue").
- **PASS (overall_pass: true)** for all other cases, including garment mismatches or pose changes, which must be noted.

### JSON Schema for the "report" Field:
{
  "overall_pass": "boolean",
  "confidence_score": "number",
  "failure_category": "string | null",
  "mismatch_reason": "string | null",
  "garment_comparison": {
    "notes": "string",
    "scores": {
      "color_fidelity": "number",
      "texture_realism": "number",
      "pattern_accuracy": "number",
      "fit_and_shape": "number"
    },
    "detail_fidelity": [
      {
        "detail_type": "string",
        "status": "string",
        "notes": "string | null"
      }
    ]
  },
  "pose_and_body_analysis": {
    "notes": "string",
    "scores": {
      "pose_preservation": "number",
      "anatomical_correctness": "number"
    }
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