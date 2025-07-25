import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const CHUNK_SIZE = 250;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const finalSynthesizerPrompt = `You are a master Editor-in-Chief AI. You will be given an array of pre-analyzed, structured JSON summaries from your team of "Junior Analysts". Each summary object represents a chunk of data from a larger dataset.

### Your Mission:
Your task is to synthesize these individual structured summaries into a single, cohesive, and comprehensive final report. You must not lose any detail. Your final output MUST follow the exact structure and format outlined below.

### Your Process:
1.  **Aggregate Quantitative Data:** Iterate through the \`quantitative_summary\` object of each chunk. Sum up all the numerical data (Total Jobs, Passed, Failed, all score sums, etc.) to get the grand totals for the entire pack.
2.  **Aggregate Categorical Data:** Iterate through the \`categorical_breakdowns\` object of each chunk. For each category (e.g., \`garment_type\`, \`body_type\`), merge the data. For example, if chunk 1 has \`"jacket": {"count": 10, "passed": 4}\` and chunk 2 has \`"jacket": {"count": 8, "passed": 6}\`, your final aggregate for jackets will be \`{"count": 18, "passed": 10}\`.
3.  **Calculate Final Metrics:** Using the aggregated totals, calculate the final metrics for the report, such as Overall Pass Rate, average scores (by dividing sum by count), and pass rates for each category.
4.  **Synthesize Qualitative Insights:** Read the \`qualitative_insights\` object from all the individual reports. Identify the most critical, recurring themes, hard limits, and actionable advice. Use the \`representative_failure_note\` and \`critical_outlier_note\` fields to find powerful, specific examples to include in your narrative.
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
  - Passed (with Logo Issues): A
  - Passed (with Detail Issues): B
  - Failed (Fitting Issues): C
  - Failed (Other): D
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

## 3. Garment Shape Integrity
*(A Markdown table with columns: Garment Type, Total Jobs, Shape Mismatch %)*

## 4. Performance by Garment Type
*(A Markdown table with columns: Garment Type, Total Jobs, Pass Rate %, Avg. Fit Score)*

## 5. Performance by Pattern Type
*(A Markdown table with columns: Pattern Type, Total Jobs, Pass Rate %, Avg. Pattern Accuracy)*

## 6. Performance by Body Type
*(A Markdown table with columns: Body Type, Total Jobs, Pass Rate %, Avg. Body Preservation Score)*

## 7. Camera Angle Deep Dive
*(A list or table showing the pass rate for each camera angle, e.g., "Full Shot: 85% Pass Rate")*

## 8. Strategic Recommendations
### Hard Limits & Known Issues
- (Bulleted list of identified limitations, supported by quantitative data. E.g., "The system struggles with complex patterns, achieving only a 4.5/10 average accuracy score.")
### Actionable Advice for Future Packs
- (Bulleted list of concrete recommendations, supported by both quantitative and qualitative insights from the \`notes\`.)
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
  
  const { pack_id, user_id } = await req.json();
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-Report-Worker][${pack_id}]`;

  try {
    if (!pack_id || !user_id) {
      throw new Error("pack_id and user_id are required.");
    }
    console.log(`${logPrefix} Worker started.`);

    const { data: reports, error: rpcError } = await supabase.rpc('get_vto_report_details_for_pack', {
      p_pack_id: pack_id,
      p_user_id: user_id
    });

    if (rpcError) throw new Error(`Failed to fetch report details: ${rpcError.message}`);
    if (!reports || reports.length === 0) {
      throw new Error("No analysis reports found for this pack to synthesize.");
    }

    const comparativeReports = reports.map((r: any) => r.comparative_report).filter(Boolean);
    if (comparativeReports.length === 0) {
        throw new Error("No valid comparative reports found in the fetched data.");
    }

    console.log(`${logPrefix} Found ${comparativeReports.length} reports. Chunking and dispatching to sub-workers...`);

    const chunks = [];
    for (let i = 0; i < comparativeReports.length; i += CHUNK_SIZE) {
        chunks.push(comparativeReports.slice(i, i + CHUNK_SIZE));
    }

    const chunkPromises = chunks.map((chunk, index) => {
        console.log(`${logPrefix} Invoking chunk worker ${index + 1}/${chunks.length}...`);
        return supabase.functions.invoke('MIRA-AGENT-analyzer-vto-report-chunk-worker', {
            body: { reports_chunk: chunk }
        });
    });

    const chunkResults = await Promise.allSettled(chunkPromises);
    
    const successfulResults = chunkResults
        .filter(result => result.status === 'fulfilled' && !result.value.error)
        .map((result: any) => result.value.data);

    const failedResults = chunkResults.filter(result => result.status === 'rejected' || (result.status === 'fulfilled' && result.value.error));
    
    if (failedResults.length > 0) {
        console.warn(`[VTO-Report-Worker][${pack_id}] ${failedResults.length}/${chunks.length} chunk workers failed. Proceeding with partial data.`);
        failedResults.forEach((result: any) => {
            if (result.status === 'rejected') {
                console.error(` - Worker rejected with reason:`, result.reason);
            } else {
                console.error(` - Worker fulfilled but returned an error:`, result.value.error);
            }
        });
    }

    if (successfulResults.length === 0) {
        throw new Error("All chunk analysis workers failed. Cannot synthesize report.");
    }

    const chunkReports = successfulResults;
    console.log(`${logPrefix} ${chunkReports.length} chunk workers completed successfully. Starting final synthesis.`);

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

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[VTO-Report-Worker][${pack_id}] Error:`, error);
    await supabase.from('mira-agent-vto-packs-jobs').update({
        synthesis_report: `# Analysis Failed\n\nAn error occurred during the report synthesis: ${error.message}`
    }).eq('id', pack_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});