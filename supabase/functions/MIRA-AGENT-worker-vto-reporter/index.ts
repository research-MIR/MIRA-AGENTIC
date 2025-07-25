import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const garmentAnalysisPrompt = `You are a fashion cataloger. Analyze the provided garment image and return a JSON object with the keys \`garment_type\`, \`pattern_type\`, \`has_logo\`, and \`notes\`.
- \`garment_type\` must be one of: 't-shirt', 'jacket', 'dress', 'pants', 'skirt', 'shoes', 'accessory', 'other'.
- \`pattern_type\` must be one of: 'solid', 'striped', 'plaid', 'floral', 'graphic', 'complex', 'other'.
- \`has_logo\` must be a boolean.
- \`notes\` must be a brief, qualitative description of the reference garment.
Your entire response must be only the valid JSON object.`;

const comparativeAnalysisPrompt = `You are a meticulous, final-stage Quality Assurance inspector AI acting as a "Forensic Scientist". You will be given a preliminary JSON analysis of the reference garment, and three images: a SOURCE PERSON image, a REFERENCE GARMENT image, and a FINAL RESULT image.

### Your Mission:
Your primary task is to use the provided images and preliminary analysis to visually verify and expand upon the initial findings. The preliminary analysis is a starting point, but **your own visual inspection is the final authority**. Your final output MUST be a single, valid JSON object following the specified schema.

### Your Process & Rules:
1.  **Forensic Garment Comparison:** Visually compare the garment in the FINAL RESULT against the REFERENCE GARMENT.
2.  **Pose & Scene Integrity:** Compare the FINAL RESULT to the SOURCE PERSON image.
3.  **Body Type Analysis:** You MUST analyze the SOURCE PERSON image and classify their physique.
4.  **Quantitative Scoring (MANDATORY):** You MUST provide a \`scores\` object for both \`garment_comparison\` and \`pose_and_body_analysis\`. Each score MUST be a number from 0.0 to 10.0.
5.  **Qualitative Notes (MANDATORY):** For each section (\`garment_comparison\`, \`pose_and_body_analysis\`), you MUST write a detailed, human-readable \`notes\` string that justifies your scores and describes your observations.
6.  **Nuanced Pass/Fail Logic (CRITICAL):**
    - **CRITICAL FAILURE CONDITION: Shape Mismatch:** You MUST compare the \`garment_analysis.garment_type\` (from the reference image) with your own visual analysis of the garment in the FINAL RESULT, which you will record in \`generated_garment_type\`. If \`generated_garment_type\` does not match \`garment_analysis.garment_type\` (e.g., the reference is a 'jacket' but the result is a 't-shirt' or 'crop-top'), this is an automatic failure. In this specific case, you MUST set: \`"overall_pass": false\` and \`"failure_category": "shape_mismatch"\`.
    - **FAIL (\`overall_pass: false\`)** for other significant TECHNICAL FLAWS. A simple change in pose is NOT a failure condition on its own, but it MUST be noted.
    - **FAIL IF:** The body is unnaturally altered (\`failure_category: "body_distortion"\`), there are severe anatomical errors (\`failure_category: "anatomical_error"\`), the lighting/blending is poor (\`failure_category: "quality_issue"\`), or the garment fit is fundamentally wrong (\`failure_category: "fitting_issue"\`).
    - **PASS (\`overall_pass: true\`)** if the image is technically sound and does not meet any failure criteria.
    - **PASS WITH NOTES (\`pass_with_notes: true\`)** if the image is a PASS but has minor, specific flaws. If true, you MUST set \`pass_notes_category\` to one of: \`'logo_fidelity'\`, \`'detail_accuracy'\`, or \`'minor_artifact'\`.
7.  **Camera & Pose Analysis:** You MUST analyze the \`original_camera_angle\` and populate the \`shot_type\`, \`camera_elevation\`, and \`camera_position\` fields with the most appropriate values from the provided enums.
8.  **Garment Type Verification:** You MUST identify the type of garment in the FINAL RESULT and populate the \`generated_garment_type\` field.
9.  **Body Type Preservation:** You MUST assess if the model's body type was altered from the SOURCE PERSON image and reflect this in the \`body_type_preservation\` score.
10. **Unsolicited Garment Detection:** You MUST check if the AI generated additional, unrequested garments. Set \`unsolicited_garment_generated\` to \`true\` if this occurs. This is an observation, NOT a failure condition.

### JSON Schema (Your Output):
{
  "overall_pass": "boolean",
  "pass_with_notes": "boolean",
  "pass_notes_category": "logo_fidelity" | "detail_accuracy" | "minor_artifact" | null,
  "failure_category": "shape_mismatch" | "fitting_issue" | "body_distortion" | "anatomical_error" | "quality_issue" | "other" | null,
  "confidence_score": "number",
  "garment_comparison": {
    "generated_garment_type": "t-shirt" | "jacket" | "dress" | "pants" | "skirt" | "shoes" | "accessory" | "other" | null,
    "scores": { "color_fidelity": "number", "texture_realism": "number", "pattern_accuracy": "number", "fit_and_shape": "number", "logo_fidelity": "number", "detail_accuracy": "number" },
    "notes": "string"
  },
  "pose_and_body_analysis": {
    "original_camera_angle": { "shot_type": "full_shot" | "medium_shot" | "close_up" | "other", "camera_elevation": "eye_level" | "high_angle" | "low_angle", "camera_position": "frontal" | "three_quarter" | "profile" },
    "body_type": "slim" | "athletic" | "average" | "plus-size" | "other",
    "pose_changed": "boolean",
    "unsolicited_garment_generated": "boolean",
    "scores": { "pose_preservation": "number", "anatomical_correctness": "number", "body_type_preservation": "number" },
    "notes": "string"
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

    console.log(`${logPrefix} Stage 1: Analyzing reference garment...`);
    const garment_analysis = await analyzeGarment(ai, supabase, vtoJob.source_garment_image_url, "REFERENCE GARMENT");
    await supabase.from('mira-agent-vto-qa-reports').update({ reference_garment_analysis: garment_analysis }).eq('id', qa_job_id);
    console.log(`${logPrefix} Stage 1 complete.`);

    console.log(`${logPrefix} Stage 2: Performing comparative analysis with all visual evidence...`);
    const [personImageParts, referenceGarmentParts, finalResultParts] = await Promise.all([
        downloadImageAsPart(supabase, vtoJob.source_person_image_url, "SOURCE PERSON"),
        downloadImageAsPart(supabase, vtoJob.source_garment_image_url, "REFERENCE GARMENT"),
        downloadImageAsPart(supabase, vtoJob.final_image_url, "FINAL RESULT")
    ]);

    const comparisonParts: Part[] = [
        { text: "--- PRELIMINARY REFERENCE GARMENT ANALYSIS (JSON) ---" },
        { text: JSON.stringify(garment_analysis) },
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
    const comparative_report = {
        ...extractJson(comparisonResult.text),
        garment_analysis: garment_analysis // Inject the preliminary analysis into the final report
    };
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