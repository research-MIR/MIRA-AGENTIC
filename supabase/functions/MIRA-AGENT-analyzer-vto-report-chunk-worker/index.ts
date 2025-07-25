import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

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
    -   \`garment_type_details\`: An object where keys are the \`garment_analysis.garment_type\`. Each value is an object with \`count\`, \`passed\`, \`sum_fit_score\`, and \`shape_mismatches\`.
    -   \`pattern_type_details\`: An object where keys are the \`garment_analysis.pattern_type\`. Each value is an object with \`count\`, \`passed\`, and \`sum_pattern_accuracy_score\`.
    -   \`body_type_details\`: An object where keys are the \`pose_and_body_analysis.body_type\`. Each value is an object with \`count\`, \`passed\`, and \`sum_body_preservation_score\`.
    -   \`shot_type_details\`: An object where keys are the \`pose_and_body_analysis.original_camera_angle.shot_type\`. Each value is an object with \`count\` and \`passed\`.
    -   \`failure_summary_by_body_type\`: A nested object. Top-level keys are the \`body_type\`. Each value is another object where keys are the \`failure_category\` and values are the count of occurrences for that specific body type.

#### 3. "qualitative_insights" Object:
-   Analyze the text fields to find narrative trends.
    -   \`pattern_definitions\`: An object where keys are the unique \`garment_analysis.pattern_type\` values found in the data. The value for each key MUST be a direct quote from the \`garment_analysis.notes\` of a representative report for that pattern type.
    -   \`representative_failure_notes\`: An object where keys are the unique \`failure_category\` values. The value for each key MUST be a direct quote of a \`pass_notes_details\` or \`garment_comparison.notes\` that best exemplifies that failure.
`;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const extractJson = (text: string): any => {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { chunk_id } = await req.json();
  if (!chunk_id) {
    return new Response(JSON.stringify({ error: "chunk_id is required." }), { status: 400, headers: corsHeaders });
  }
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-Report-Chunk-Worker][${chunk_id}]`;

  try {
    // Immediately set status to processing to prevent watchdog re-triggering
    await supabase
      .from('mira-agent-vto-report-chunks')
      .update({ status: 'processing' })
      .eq('id', chunk_id);

    const { data: chunkJob, error: fetchError } = await supabase
      .from('mira-agent-vto-report-chunks')
      .select('chunk_data')
      .eq('id', chunk_id)
      .single();
    
    if (fetchError) throw fetchError;
    if (!chunkJob || !chunkJob.chunk_data) throw new Error("Chunk job not found or is missing data.");

    const reports_chunk = chunkJob.chunk_data;

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

    await supabase
      .from('mira-agent-vto-report-chunks')
      .update({ result_data: analysisResult, status: 'complete' })
      .eq('id', chunk_id);

    console.log(`${logPrefix} Analysis complete and saved to database.`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase
      .from('mira-agent-vto-report-chunks')
      .update({ status: 'failed', error_message: error.message })
      .eq('id', chunk_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});