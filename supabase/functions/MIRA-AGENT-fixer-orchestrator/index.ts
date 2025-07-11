import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type } from 'https://esm.sh/@google/genai@0.15.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";
const MAX_RETRIES = 2;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a VTO Repair Specialist. Your task is to analyze a Quality Assurance report and create a plan to fix the failed image generation.

### Your Primary Goal:
Translate the 'fix_suggestion' from the QA report into a concise, actionable instruction for the image generator.

### Your Toolkit:
You have two primary tools:
1.  \`retry_with_new_parameters\`: This is your main tool. Use its \`prompt_appendix\` argument to provide the new instruction. For example, if the suggestion is "Try adding 'natural cotton texture'", you should call the tool with \`prompt_appendix: "natural cotton texture"\`.
2.  \`give_up\`: If the problem seems unfixable (e.g., the model is completely wrong) or you are out of ideas, call this function with a clear reason.

### Your Process:
1.  Analyze the 'mismatch_reason' and 'fix_suggestion'.
2.  Call ONE of your tools. Your entire response must be a single tool call.`;

const tools = [
  {
    functionDeclarations: [
      {
        name: "retry_with_new_parameters",
        description: "The final step. Re-queues the VTO job with a new instruction to fix the prompt.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt_appendix: { type: Type.STRING, description: "A short, specific instruction to add to the original prompt to fix the issue, based on the QA report's suggestion." },
          },
          required: ["prompt_appendix"],
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

    if (!lastReport) {
        throw new Error("Job is awaiting fix but has no QA report in its history.");
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

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const model = ai.getGenerativeModel({ model: MODEL_NAME, systemInstruction: systemPrompt, tools });
    
    const chat = model.startChat({
        history: [
            { role: 'user', parts: [{ text: `A VTO job failed quality assurance. Here is the report:\n\n${JSON.stringify(lastReport, null, 2)}\n\nPlease formulate a plan to fix it.` }] }
        ]
    });

    console.log(`${logPrefix} Sending QA report to Gemini to formulate a plan.`);
    const result = await chat.sendMessage("Formulate the plan.");
    const call = result.response.functionCalls()?.[0];

    if (!call) {
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

    // Asynchronously invoke the executor to carry out the plan
    supabase.functions.invoke('MIRA-AGENT-fixer-executor', { body: { job_id } }).catch(console.error);
    console.log(`${logPrefix} Executor invoked asynchronously.`);

    return new Response(JSON.stringify({ success: true, plan: repair_plan }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Fixer orchestrator failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});