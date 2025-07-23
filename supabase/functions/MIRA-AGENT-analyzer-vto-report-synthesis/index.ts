import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const CHUNK_SIZE = 20;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const finalSynthesizerPrompt = `You are a master Editor-in-Chief AI. You will be given an array of pre-written, detailed analysis reports, where each report covers a small batch of data from a larger dataset.

### Your Mission:
Your task is to synthesize these individual reports into a single, cohesive, and comprehensive final report. You must not lose any detail. Your final output MUST follow the exact structure and format outlined below.

### Your Process:
1.  **Aggregate Quantitative Data:** Sum up all the numerical data from each report (Total Jobs, Passed, Failed) to get the grand totals for the entire pack. Recalculate the final pass rates based on these new totals.
2.  **Calculate Special Metrics:** Calculate the "Outfit Completion Rate": the percentage of *passed* jobs where \`garment_comparison.generated_extra_garments\` was true.
3.  **Synthesize Qualitative Insights:** Read the "Strategic Recommendations" sections from all reports. Identify the most critical, recurring themes, hard limits, and actionable advice. Combine them into a unified, non-redundant list in the final report.
4.  **Combine Camera Angle Analysis:** Merge the camera angle data from all reports to present a complete picture for each shot type.

### OUTPUT FORMAT
Your entire response MUST be a single, valid JSON object with "thinking" and "report" keys.

**1. The "thinking" Field:**
- This is your scratchpad. Write down your aggregation calculations and synthesis notes here.

**2. The "report" Field:**
- This field must contain the final, user-facing report as a single Markdown string, following this exact structure:

# VTO Pack Analysis Report

## 1. Executive Summary
A brief, one-paragraph overview of the pack's performance and the most critical findings.

## 2. Quantitative Analysis
- **Overall Performance:**
  - Total Jobs: X
  - Passed: Y
  - Failed: Z
  - **Overall Pass Rate: XX.X%**
- **Conditional Hit Rates:**
  - Anatomy-Adjusted Hit Rate: XX.X%
  - Garment-Adjusted Hit Rate: XX.X%
  - Complex Pattern Forgiveness Hit Rate: XX.X%
  - **Outfit Completion Rate (among passed jobs): XX.X%**

## 3. Camera Angle Deep Dive
### Full Shot
- Pass Rate: XX.X%
- Key Failure Types: ...
### Medium Shot
- Pass Rate: XX.X%
- Key Failure Types: ...
*(...and so on for each angle)*

## 4. Strategic Recommendations
### Hard Limits & Known Issues
- (Bulleted list of identified limitations)
### The Safe Zone: Your Most Reliable Inputs
- (Description of the ideal conditions for success)
### Actionable Advice for Future Packs
- (Bulleted list of concrete recommendations)
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
    const { pack_id, user_id } = await req.json();
    if (!pack_id || !user_id) {
      throw new Error("pack_id and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[VTO-Report-Synthesizer][${pack_id}]`;
    console.log(`${logPrefix} Starting synthesis orchestration.`);

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

    console.log(`${logPrefix} Found ${comparativeReports.length} reports. Chunking and dispatching to workers...`);

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

    const chunkResults = await Promise.all(chunkPromises);
    const chunkReports = chunkResults.map(result => {
        if (result.error) throw new Error(`A chunk worker failed: ${result.error.message}`);
        return result.data;
    });

    console.log(`${logPrefix} All ${chunkReports.length} chunk workers completed. Starting final synthesis.`);

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
        synthesis_thinking: finalAnalysis.thinking
      })
      .eq('id', pack_id);

    if (updateError) {
      console.error(`${logPrefix} Failed to save final analysis to DB:`, updateError);
    }

    return new Response(JSON.stringify(finalAnalysis), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[VTO-Report-Synthesizer] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});