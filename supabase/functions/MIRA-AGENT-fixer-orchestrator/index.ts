import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type, Content, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';

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

const systemPrompt = `You are a VTO Repair Specialist AI. Your task is to analyze a Quality Assurance (QA) report and an original API request payload, then construct a new, corrected payload to fix the reported issue.

### Core Directive:
You MUST respond with a call to the \`execute_vto_job\` tool. Do not provide any other text, explanation, or conversation. Your entire output must be a single function call.

### Process:
1.  **Analyze Failure:** Read the 'mismatch_reason' and 'fix_suggestion' from the QA report to understand the problem.
2.  **Construct New Payload:**
    -   Start with the 'original_request_payload'.
    -   Modify the payload based *only* on the 'fix_suggestion'. This usually involves changing the 'prompt' or 'prompt_appendix' field.
    -   Preserve all other fields from the original payload unless the fix explicitly requires changing them.
3.  **Execute Tool Call:** Call the \`execute_vto_job\` tool, passing the entire new JSON payload you constructed as the 'payload' argument.
`;

const tools = [
  {
    functionDeclarations: [
      {
        name: "execute_vto_job",
        description: "The final step. Re-queues the VTO job with a new, complete payload to fix the issue.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            payload: { type: Type.OBJECT, description: "The entire, new, valid JSON payload to be sent to the BitStudio API for the retry attempt." },
          },
          required: ["payload"],
        },
      },
      {
        name: "give_up",
        description: "If the problem seems unfixable, call this function to end the process.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            reason: { type: Type.STRING, description: "A user-friendly explanation for why the automated fix failed." },
          },
          required: ["reason"],
        },
      },
    ],
  },
];

function extractJsonFromText(text: string): any | null {
    if (!text) return null;
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        try {
            return JSON.parse(match[1]);
        } catch (e) {
            console.error("Failed to parse extracted JSON block:", e);
            return null;
        }
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function getToolCallFromResponse(result: GenerationResult): { name: string; args: any } | null {
    if (result.functionCalls && result.functionCalls.length > 0) {
        console.log("Found direct function call from model.");
        return result.functionCalls[0];
    }

    const text = result.text;
    if (text) {
        console.log("No direct function call. Attempting to extract JSON payload from text response.");
        const extractedJson = extractJsonFromText(text);
        if (extractedJson) {
            console.log("Successfully extracted JSON payload from text. Reconstructing 'execute_vto_job' tool call.");
            return {
                name: 'execute_vto_job',
                args: { payload: extractedJson }
            };
        }
    }
    
    return null;
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
    const lastReport = qaHistory[qaHistory.length - 1];
    const originalPayload = job.metadata?.original_request_payload;

    if (!lastReport) throw new Error("Job is awaiting fix but has no QA report in its history.");
    if (!originalPayload) throw new Error("Job is awaiting fix but has no original_request_payload in its metadata.");

    console.log(`${logPrefix} Current retry count: ${retryCount}. Analyzing last QA report.`);

    if (retryCount >= MAX_RETRIES) {
      console.log(`${logPrefix} Max retries reached. Giving up.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({ 
        status: 'permanently_failed', 
        error_message: 'Automated repair failed after multiple attempts.' 
      }).eq('id', job_id);
      return new Response(JSON.stringify({ success: true, message: "Max retries reached." }), { headers: corsHeaders });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    
    const contents: Content[] = [
        { role: 'user', parts: [{ text: `A VTO job failed quality assurance. Here is the report and the original request payload that caused the failure. Your task is to construct a new, complete payload to fix the issue.\n\n**QA REPORT:**\n${JSON.stringify(lastReport, null, 2)}\n\n**ORIGINAL REQUEST PAYLOAD:**\n${JSON.stringify(originalPayload, null, 2)}` }] }
    ];

    let result: GenerationResult | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`${logPrefix} Calling Gemini model, attempt ${attempt}...`);
            result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: contents,
                tools: tools,
                config: {
                    systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }
                }
            });
            break; // Success, exit loop
        } catch (error) {
            if (error.message.includes("503") && attempt < MAX_RETRIES) {
                console.warn(`${logPrefix} Gemini API is overloaded (503). Retrying in ${RETRY_DELAY_MS}ms...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            } else {
                throw error; // Rethrow if it's not a 503 or if it's the last attempt
            }
        }
    }
    
    if (!result) {
        throw new Error("AI planner failed to respond after all retries.");
    }

    const call = getToolCallFromResponse(result);

    if (!call) {
      console.error(`${logPrefix} Orchestrator LLM did not return a valid function call. Full raw response object:`, JSON.stringify(result, null, 2));
      throw new Error("Orchestrator LLM did not return a valid function call.");
    }

    console.log(`${logPrefix} LLM decided to call: ${call.name} with args:`, call.args);

    const repair_plan = {
      action: call.name,
      parameters: call.args,
    };

    await supabase.from('mira-agent-bitstudio-jobs')
      .update({ 
        metadata: { ...job.metadata, current_fix_plan: repair_plan }, 
        status: 'fixing' 
      })
      .eq('id', job_id);
    
    console.log(`${logPrefix} Repair plan saved to job metadata. Status updated to 'fixing'.`);

    supabase.functions.invoke('MIRA-AGENT-fixer-executor', { body: { job_id } }).catch(console.error);
    console.log(`${logPrefix} Executor invoked asynchronously.`);

    return new Response(JSON.stringify({ success: true, plan: repair_plan }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Fixer orchestrator failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});