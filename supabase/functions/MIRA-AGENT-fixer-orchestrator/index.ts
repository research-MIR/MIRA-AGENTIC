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

const systemPrompt = `You are a VTO Repair Specialist. Your task is to analyze a Quality Assurance report detailing why an image generation failed and create a step-by-step JSON plan to fix it.

You have a toolkit of functions. Your plan MUST be a sequence of calls to these functions.

1.  **Analyze the 'mismatch_reason' and 'fix_suggestion' in the QA report.**
2.  **Formulate a strategy.** If the shape is wrong, you should adjust the 'denoise' parameter. If the color or texture is wrong, you should modify the prompt. You can do both.
3.  **Execute the fix.** Your final step MUST ALWAYS be a call to \`retry_with_new_parameters\`, which will take your prepared changes and re-run the generation.

If you believe the issue is unfixable or you have no new ideas, you MUST call the \`give_up\` function with a clear reason.`;

const tools = [
  {
    functionDeclarations: [
      {
        name: "retry_with_new_parameters",
        description: "The final step. Re-queues the VTO job with the specified modifications.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            prompt_appendix: { type: Type.STRING, description: "A short, specific instruction to add to the original prompt to fix the issue." },
            denoise_value: { type: Type.NUMBER, description: "A new denoise value between 0.5 and 1.0. Use lower values to fix shape/distortion issues." },
          },
          required: [],
        },
      },
      {
        name: "give_up",
        description: "If the problem seems unfixable or you are out of ideas, call this function to end the process.",
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
  console.log(`[FixerOrchestrator][${job_id}] Invoked.`);

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

    if (retryCount >= MAX_RETRIES) {
      console.log(`[FixerOrchestrator][${job_id}] Max retries reached. Giving up.`);
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

    const result = await chat.sendMessage("Formulate the plan.");
    const call = result.response.functionCalls()?.[0];

    if (!call) {
      throw new Error("Orchestrator LLM did not return a valid function call.");
    }

    console.log(`[FixerOrchestrator][${job_id}] LLM decided to call: ${call.name} with args:`, call.args);

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

    // Asynchronously invoke the executor to carry out the plan
    supabase.functions.invoke('MIRA-AGENT-fixer-executor', { body: { job_id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, plan: repair_plan }), { headers: corsHeaders });

  } catch (error) {
    console.error(`[FixerOrchestrator][${job_id}] Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Fixer orchestrator failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});