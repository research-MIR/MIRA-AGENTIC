import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a VTO Repair Specialist AI. Your task is to analyze a Quality Assurance (QA) report and an original API request payload, then decide on a course of action.

### Your Process:
1.  **Analyze Failure:** Read the 'mismatch_reason' and 'fix_suggestion' from the QA report to understand the problem.
2.  **Decide Action:**
    -   If the issue is fixable (e.g., requires a more descriptive prompt), decide to "retry".
    -   If the issue seems unfixable (e.g., the model cannot handle the request), decide to "give_up".
3.  **Construct Output:** Based on your decision, create a single, valid JSON object.

### Output Format & Rules:
Your entire output MUST be a single, valid JSON object. Do not include any other text or explanations.

**If you decide to retry:**
\`\`\`json
{
  "action": "retry",
  "payload": { ... }
}
\`\`\`
- The "payload" object MUST be the complete, new, corrected JSON payload to be sent to the BitStudio API. Start with the 'original_request_payload' and modify it according to the 'fix_suggestion'.

**If you decide to give up:**
\`\`\`json
{
  "action": "give_up",
  "reason": "A user-friendly explanation for why the automated fix failed."
}
\`\`\`
`;

function extractJson(text: string): any | null {
    if (!text) return null;
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        try { return JSON.parse(match[1]); } catch (e) { console.error("Failed to parse extracted JSON block:", e); return null; }
    }
    try { return JSON.parse(text); } catch (e) { return null; }
}

serve(async (req) => {
  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required for the fixer-orchestrator.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[FixerOrchestrator][${job_id}]`;
  console.log(`${logPrefix} Invoked.`);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('metadata')
      .eq('id', job_id)
      .single();
    if (fetchError) throw fetchError;

    const retryCount = job.metadata?.retry_count || 0;
    const qaHistory = job.metadata?.qa_history || [];
    const fixHistory = job.metadata?.fix_history || [];
    const lastReportObject = qaHistory[qaHistory.length - 1];
    const lastReport = lastReportObject?.report;
    const failedImageUrl = lastReportObject?.failed_image_url;
    const originalPayload = job.metadata?.original_request_payload;
    const sourceImageUrl = job.metadata?.source_image_url;
    const referenceImageUrl = job.metadata?.reference_image_url;

    if (!lastReport) throw new Error("Job is awaiting fix but has no QA report in its history.");
    if (!originalPayload) throw new Error("Job is awaiting fix but has no original_request_payload in its metadata.");

    if (!sourceImageUrl || !referenceImageUrl || !failedImageUrl) {
        console.warn(`${logPrefix} Missing one or more critical URLs for full context. Source: ${!!sourceImageUrl}, Reference: ${!!referenceImageUrl}, Failed: ${!!failedImageUrl}`);
    }

    console.log(`${logPrefix} Current retry count: ${retryCount}. Analyzing last QA report.`);

    if (retryCount >= MAX_RETRIES) {
      console.log(`${logPrefix} Max retries reached. Giving up.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({ 
        status: 'permanently_failed', 
        error_message: 'Automated repair failed after multiple attempts.' 
      }).eq('id', job_id);
      return new Response(JSON.stringify({ success: true, message: "Max retries reached." }), { headers: corsHeaders });
    }

    // Set status to 'fixing' to prevent watchdog interference
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'fixing' }).eq('id', job_id);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const geminiInputPrompt = `A VTO job failed quality assurance. Here is the report and the original request payload that caused the failure. Your task is to construct a new, complete payload to fix the issue.

**CONTEXTUAL IMAGE URLS:**
- Source Person Image: ${sourceImageUrl || "Not Available"}
- Reference Garment Image: ${referenceImageUrl || "Not Available"}
- Failed Result Image (The one you are critiquing): ${failedImageUrl || "Not Available"}

**QA REPORT:**
${JSON.stringify(lastReport, null, 2)}

**ORIGINAL REQUEST PAYLOAD (The one that produced the failed image):**
${JSON.stringify(originalPayload, null, 2)}`;
    const contents: Content[] = [{ role: 'user', parts: [{ text: geminiInputPrompt }] }];

    let result: GenerationResult | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`${logPrefix} Calling Gemini model, attempt ${attempt}...`);
            result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: contents,
                generationConfig: { responseMimeType: "application/json" },
                config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
            });
            break;
        } catch (error) {
            if (error.message.includes("503") && attempt < MAX_RETRIES) {
                console.warn(`${logPrefix} Gemini API is overloaded (503). Retrying in ${RETRY_DELAY_MS}ms...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            } else {
                throw error;
            }
        }
    }
    
    if (!result || !result.text) {
        throw new Error("AI planner failed to respond after all retries.");
    }

    console.log(`${logPrefix} Raw Gemini response:`, result.text);
    const plan = extractJson(result.text);
    console.log(`${logPrefix} Parsed plan:`, JSON.stringify(plan, null, 2));

    if (!plan || !plan.action) {
      console.error(`${logPrefix} Orchestrator LLM did not return a valid JSON action. Full raw response:`, result.text);
      throw new Error("Orchestrator LLM did not return a valid JSON action.");
    }

    console.log(`${logPrefix} LLM decided on action: ${plan.action}`);

    const currentFixAttemptLog = {
        timestamp: new Date().toISOString(),
        retry_number: retryCount + 1,
        qa_report_used: lastReportObject,
        gemini_input_prompt: geminiInputPrompt,
        gemini_raw_output: result.text,
        parsed_plan: plan,
    };

    // --- EXECUTION LOGIC ---
    switch (plan.action) {
      case 'retry': {
        const payload = plan.payload;
        if (!payload) throw new Error("Plan action 'retry' is missing the 'payload' parameter.");
        
        console.log(`${logPrefix} Preparing to retry job with new payload.`);
        
        await supabase.from('mira-agent-bitstudio-jobs')
          .update({ 
            metadata: { ...job.metadata, fix_history: [...fixHistory, currentFixAttemptLog] }
          })
          .eq('id', job_id);

        const { error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
          body: {
            retry_job_id: job_id,
            payload: payload,
          }
        });
        if (proxyError) throw proxyError;

        console.log(`${logPrefix} Successfully sent retry request to proxy for job ${job_id}.`);
        break;
      }
      case 'give_up': {
        await supabase.from('mira-agent-bitstudio-jobs')
          .update({ 
            status: 'permanently_failed', 
            error_message: plan.reason,
            metadata: { ...job.metadata, fix_history: [...fixHistory, currentFixAttemptLog] }
          })
          .eq('id', job_id);
        console.log(`${logPrefix} Agent gave up. Reason: ${plan.reason}. Job marked as permanently_failed.`);
        break;
      }
      default:
        throw new Error(`Unknown plan action: ${plan.action}`);
    }

    return new Response(JSON.stringify({ success: true, plan }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Fixer orchestrator failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});