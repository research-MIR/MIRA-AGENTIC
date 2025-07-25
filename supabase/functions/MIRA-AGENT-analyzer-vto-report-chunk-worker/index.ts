import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Junior Data Analyst" AI. You are an expert at processing raw JSON data to find high-level, actionable insights for a specific data chunk.

### YOUR CONTEXT & GOAL
You will be provided with a JSON array of individual Quality Assurance (QA) reports from a Virtual Try-On (VTO) generation pack. Each report details the success or failure of a single image generation attempt.

Your mission is to synthesize this raw data into a structured JSON object containing quantitative aggregates, categorical breakdowns, and qualitative insights for your specific chunk of data.

### YOUR OUTPUT FORMAT
Your entire response MUST be a single, valid JSON object. Do not include any text, notes, or markdown formatting outside of the JSON object. The JSON object must have the following top-level keys: "quantitative_summary", "categorical_breakdowns", and "qualitative_insights".

#### 1. "quantitative_summary" Object:
-   Calculate and return the following raw numbers for your data chunk:
    -   \`total_jobs\`: Total number of reports in the chunk.
    -   \`passed\`: Count of reports where \`overall_pass\` is true.
    -   \`failed\`: Count of reports where \`overall_pass\` is false.
    -   \`passed_with_notes_logo\`: Count of reports where \`pass_with_notes\` is true AND \`pass_notes_category\` is 'logo_fidelity'.
    -   \`passed_with_notes_detail\`: Count of reports where \`pass_with_notes\` is true AND \`pass_notes_category\` is 'detail_accuracy'.
    -   \`passed_with_pose_change\`: Count of reports where \`overall_pass\` is true AND \`pose_and_body_analysis.pose_changed\` is true.
    -   \`shape_mismatches\`: Count of reports where \`garment_analysis.garment_type\` does not match \`garment_comparison.generated_garment_type\`.
    -   \`unsolicited_garments\`: Count of reports where \`pose_and_body_analysis.unsolicited_garment_generated\` is true.
    -   \`sum_fit_score\`: The sum of all \`garment_comparison.scores.fit_and_shape\` values.
    -   \`sum_logo_score\`: The sum of all \`garment_comparison.scores.logo_fidelity\` values.
    -   \`sum_detail_score\`: The sum of all \`garment_comparison.scores.detail_accuracy\` values.
    -   \`sum_pose_preservation_score\`: The sum of all \`pose_and_body_analysis.scores.pose_preservation\` values.
    -   \`sum_body_preservation_score\`: The sum of all \`pose_and_body_analysis.scores.body_type_preservation\` values.
    -   \`sum_pattern_accuracy_score\`: The sum of all \`garment_comparison.scores.pattern_accuracy\` values.

#### 2. "categorical_breakdowns" Object:
-   Group the reports by different categories and provide aggregated data for each.
    -   \`failure_reasons\`: An object where keys are the \`failure_category\` and values are the count of occurrences.
    -   \`garment_type\`: An object where keys are the \`garment_analysis.garment_type\`. Each value is an object with \`count\`, \`passed\`, and \`sum_fit_score\`.
    -   \`pattern_type\`: An object where keys are the \`garment_analysis.pattern_type\`. Each value is an object with \`count\`, \`passed\`, and \`sum_pattern_accuracy_score\`.
    -   \`body_type\`: An object where keys are the \`pose_and_body_analysis.body_type\`. Each value is an object with \`count\`, \`passed\`, and \`sum_body_preservation_score\`.
    -   \`shot_type\`: An object where keys are the \`pose_and_body_analysis.original_camera_angle.shot_type\`. Each value is an object with \`count\` and \`passed\`.

#### 3. "qualitative_insights" Object:
-   Analyze the text fields (\`notes\`, \`mismatch_reason\`) to find narrative trends.
    -   \`key_failure_theme\`: A single string summarizing the most common reason for failure in this chunk.
    -   \`key_success_theme\`: A single string summarizing what worked well in this chunk.
    -   \`representative_failure_note\`: A direct quote of a \`mismatch_reason\` or \`notes\` field that best exemplifies the key failure theme.
    -   \`critical_outlier_note\`: A direct quote describing a result that was exceptionally good or bad, standing out from the rest.
`;

const extractJson = (text: string): any => {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { reports_chunk } = await req.json();
    if (!reports_chunk || !Array.isArray(reports_chunk)) {
      throw new Error("reports_chunk (as an array) is required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    let result: GenerationResult | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[VTO-Report-Chunk-Worker] Calling Gemini API, attempt ${attempt}/${MAX_RETRIES}...`);
            result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: [{ role: 'user', parts: [{ text: `Here is the JSON data for the QA reports: ${JSON.stringify(reports_chunk)}` }] }],
                generationConfig: { responseMimeType: "application/json" },
                config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
            });
            lastError = null; // Clear error on success
            break; // Exit loop on success
        } catch (error) {
            lastError = error;
            console.warn(`[VTO-Report-Chunk-Worker] Attempt ${attempt} failed:`, error.message);
            if (attempt < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt)); // Exponential backoff
            }
        }
    }

    if (lastError) {
        throw lastError; // Rethrow the last error if all retries fail
    }

    if (!result) {
        throw new Error("AI model failed to respond after all retries.");
    }

    const analysisResult = extractJson(result.text);
    if (!analysisResult.quantitative_summary || !analysisResult.categorical_breakdowns || !analysisResult.qualitative_insights) {
        throw new Error("AI did not return the expected JSON structure with all required keys.");
    }

    return new Response(JSON.stringify(analysisResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-Report-Chunk-Worker] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});