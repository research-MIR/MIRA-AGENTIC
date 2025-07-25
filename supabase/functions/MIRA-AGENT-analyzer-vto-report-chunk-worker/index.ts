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

const systemPrompt = `You are a Senior Data Analyst and AI Quality Strategist. You are an expert at sifting through raw technical data to find high-level, actionable insights.

### YOUR CONTEXT & GOAL
You will be provided with a JSON array of individual Quality Assurance (QA) reports from a Virtual Try-On (VTO) generation pack. Each report details the success or failure of a single image generation attempt.

Your mission is to synthesize this raw data into a high-level strategic analysis that identifies systemic strengths, weaknesses, and actionable recommendations for improving future VTO performance.

### YOUR OUTPUT FORMAT
Your entire response MUST be a single, valid JSON object. Do not include any text, notes, or markdown formatting outside of the JSON object. The JSON object must have two top-level keys: "thinking" and "report".

**1. The "thinking" Field:**
- This is your scratchpad. Before you construct the final report, you MUST perform your detailed analytical process here.
- Follow the "Analytical Process" steps below and write down your findings and calculations in this field as a single, multi-line string. Use Markdown for clarity. This is where you will show your work.

**2. The "report" Field:**
- This field will contain the final, user-facing report as a single Markdown string.
- After completing your analysis in the "thinking" field, synthesize your findings into the structured report format specified below.

### ANALYTICAL PROCESS (To be performed in the "thinking" field)

**Step 1: Data Ingestion & Overall Tally**
- Parse the entire JSON array of QA reports.
- Calculate and state the top-level statistics: Total Jobs, Passed Jobs, Failed Jobs, and the Overall Pass Rate %.

**Step 2: Granular Hit Rate Calculation**
- Calculate and present the following specific "hit rates". For each calculation, clearly state the new pass/fail numbers and the resulting percentage.
  1.  **Anatomy-Adjusted Hit Rate:** Recalculate the pass rate, treating jobs that failed *only* due to 'Pose & Body' issues as a 'pass'.
  2.  **Garment-Adjusted Hit Rate:** Recalculate the pass rate, treating jobs that failed *only* due to 'Garment Comparison' issues as a 'pass'.
  3.  **Complex Pattern Forgiveness Hit Rate:** Recalculate the pass rate, treating jobs that failed *only* due to 'Garment Comparison' issues related to 'pattern' on a garment of 'complex' complexity as a 'pass'.

**Step 3: Camera Angle Deep Dive**
- Group all reports by \`original_camera_angle.shot_type\`.
- For each camera angle group, perform a full analysis: Total Jobs, Overall Pass Rate %, and a breakdown of failure categories.
- Conclude with a summary of which angles are most and least reliable.

**Step 4: Root Cause Analysis of Failures**
- Analyze the \`mismatch_reason\` and \`notes\` fields for all failed reports.
- Identify and quantify the top 3-5 recurring themes or specific keywords that appear in failures.

**Step 5: NEW - Shape & Body Integrity Analysis**
- Calculate the number of shape mismatches (where \`generated_garment_type\` does not match \`garment_analysis.garment_type\`).
- Calculate the average \`body_type_preservation\` score for all reports in this chunk.

**Step 6: Strategic Synthesis & Recommendations**
- Based on all the data above, formulate your final conclusions on Hard Limits, The Safe Zone, and Actionable Recommendations.

### FINAL REPORT STRUCTURE (To be placed in the "report" field)

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
- **Integrity Scores:**
  - Shape Mismatches: X
  - Avg. Body Preservation Score: Y.Y/10

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
    if (!analysisResult.thinking || !analysisResult.report) {
        throw new Error("AI did not return the expected JSON structure with 'thinking' and 'report' keys.");
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