import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const finalSynthesizerPrompt = `You are a master Editor-in-Chief AI. You will be given an array of pre-analyzed, structured JSON summaries from your team of "Junior Analysts". Each summary object represents a chunk of data from a larger dataset.

### Your Mission:
Your task is to synthesize these individual structured summaries into a single, cohesive, and comprehensive final report. You must not lose any detail. Your final output MUST follow the exact structure and format outlined below.

### Your Process:
1.  **Aggregate Quantitative Data:** Iterate through the \`quantitative_summary\` object of each chunk. Sum up all the numerical data (Total Jobs, Passed, Failed, all score sums, etc.) to get the grand totals for the entire pack.
2.  **Aggregate Categorical Data:** Iterate through the \`categorical_breakdowns\` object of each chunk. For each category (e.g., \`garment_type_details\`, \`body_type_details\`), merge the data. For example, if chunk 1 has \`"jacket": {"count": 10, "passed": 4, "shape_mismatches": 1}\` and chunk 2 has \`"jacket": {"count": 8, "passed": 6, "shape_mismatches": 3}\`, your final aggregate for jackets will be \`{"count": 18, "passed": 10, "shape_mismatches": 4}\`. Do the same for the nested \`failure_summary_by_body_type\` object.
3.  **Calculate Final Metrics:** Using the aggregated totals, calculate the final metrics for the report, such as Overall Pass Rate, average scores (by dividing sum by count), and pass rates for each category.
4.  **Synthesize Qualitative Insights:** Read the \`qualitative_insights\` object from all the individual reports. Merge the \`pattern_definitions\` and \`representative_failure_notes\` into single, comprehensive objects.
5.  **Create a Data-Driven Narrative:** Use the qualitative insights to write the narrative sections of your report (Executive Summary, Recommendations). You MUST use the aggregated quantitative data you calculated as hard evidence to support your qualitative observations.

### OUTPUT FORMAT
Your entire response MUST be a single, valid JSON object with "thinking" and "report" keys.

**1. The "thinking" Field:**
- This is your scratchpad. Write down your aggregation calculations and synthesis notes here. Show your work.

**2. The "report" Field:**
- This field must contain the final, user-facing report as a single Markdown string, following this exact structure:

# VTO Pack Analysis Report

## 1. Executive Summary
A brief, one-paragraph overview of the pack's performance, highlighting both key successes and the most critical areas for improvement, supported by top-level stats.

## 2. Quantitative Analysis
- **Overall Performance:**
  - Total Jobs: X
  - Passed (Perfect): Y
  - Passed (with Pose Change): A
  - Passed (with Logo Issues): B
  - Passed (with Detail Issues): C
  - Failed: D
  - **Overall Pass Rate: XX.X%**
- **Average Quality Scores (out of 10):**
  - Fit & Shape: X.X
  - Logo Fidelity: Y.Y
  - Detail Accuracy: Z.Z
  - Pose Preservation: A.A
  - Body Type Preservation: B.B
- **Integrity & Creative Metrics:**
  - Garment Shape Mismatches: X
  - Unsolicited Garments Generated (Creative Additions): Y

## 3. Garment Shape & Fit Integrity
This analysis pinpoints failures where the generated garment was a fundamentally different shape or length from the reference.
*(A Markdown table with columns: Garment Type, Total Jobs, Shape Mismatches, Pass Rate %, Avg. Fit Score)*

## 4. Failure Analysis by Body Type
This table cross-references failure categories with the model's body type, revealing specific weaknesses.
*(A Markdown table with columns: Body Type, Failure Category, Failure Count, Representative Example)*

## 5. Performance by Pattern Type
### Category Definitions
*(A Markdown list defining each pattern type, using the data from the \`pattern_definitions\` object.)*
### Performance Table
*(A Markdown table with columns: Pattern Type, Total Jobs, Pass Rate %, Avg. Pattern Accuracy)*

## 6. Deep Dive: "Passed with Issues"
*(A section with two sub-headings: "Passed (with Logo Issues)" and "Passed (with Detail Issues)". Each sub-heading should contain a summary of the common problem and a representative example note.)*

## 7. Strategic Recommendations
### Hard Limits & Known Issues
- (Bulleted list of identified limitations, supported by quantitative data from your aggregated tables.)
### Actionable Advice for Future Packs
- (Bulleted list of concrete recommendations, supported by both quantitative and qualitative insights.)
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
  
  const { pack_id } = await req.json();
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-Report-Synthesizer][${pack_id}]`;

  try {
    if (!pack_id) {
      throw new Error("pack_id is required.");
    }
    console.log(`${logPrefix} Synthesizer started.`);

    const { data: chunkResults, error: fetchError } = await supabase
      .from('mira-agent-vto-report-chunks')
      .select('result_data')
      .eq('pack_id', pack_id)
      .eq('status', 'complete');

    if (fetchError) throw fetchError;
    if (!chunkResults || chunkResults.length === 0) {
      throw new Error("No completed chunk results found to synthesize.");
    }

    const chunkReports = chunkResults.map(r => r.result_data).filter(Boolean);
    console.log(`${logPrefix} Found ${chunkReports.length} completed chunk reports. Starting final synthesis.`);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: [{ text: `Here are the individual analysis reports to synthesize: ${JSON.stringify(chunkReports)}` }] }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: finalSynthesizerPrompt }] } }
    });

    const finalAnalysis = extractJson(result.text);
    if (!finalAnalysis.thinking || !finalAnalysis.report) {
        throw new Error("Final synthesizer AI did not return the expected JSON structure.");
    }

    console.log(`${logPrefix} Final synthesis complete. Saving to database...`);
    const { error: updateError } = await supabase
      .from('mira-agent-vto-packs-jobs')
      .update({
        synthesis_report: finalAnalysis.report,
        synthesis_thinking: finalAnalysis.thinking,
      })
      .eq('id', pack_id);

    if (updateError) {
      console.error(`${logPrefix} Failed to save final analysis to DB:`, updateError);
    }

    // Clean up the chunk jobs
    const { error: deleteError } = await supabase
      .from('mira-agent-vto-report-chunks')
      .delete()
      .eq('pack_id', pack_id);
    
    if (deleteError) {
        console.error(`${logPrefix} Failed to clean up chunk jobs:`, deleteError);
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-vto-packs-jobs').update({
        synthesis_report: `# Analysis Failed\n\nAn error occurred during the report synthesis: ${error.message}`
    }).eq('id', pack_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});