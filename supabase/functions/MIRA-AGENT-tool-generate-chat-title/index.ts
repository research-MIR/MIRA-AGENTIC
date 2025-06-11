import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content } from 'https://esm.sh/@google/genai@0.15.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert at summarizing. You will be given the first message from a user in a conversation. This message may include text and images. Your sole task is to generate a concise, descriptive, 3-5 word title for this conversation that would be suitable for a sidebar history. Respond with ONLY the title text and nothing else.

Example 1:
User Message: "Can you create a photorealistic image of a knight in a dark forest?"
Your Response: "Knight in a Dark Forest"

Example 2:
User Message: [Image of a Gucci handbag] "Analyze the brand style of this product."
Your Response: "Gucci Handbag Brand Analysis"`;

async function generateTitle(ai: GoogleGenAI, userParts: Content[]): Promise<string> {
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: "user", parts: userParts }],
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });
    return result.text.trim().replace(/"/g, ""); // Clean up quotes
}

async function updateJobTitle(supabase: SupabaseClient, jobId: string, title: string) {
    const { error } = await supabase
        .from('mira-agent-jobs')
        .update({ original_prompt: title })
        .eq('id', jobId);

    if (error) {
        console.error(`[ChatTitler][${jobId}] Error updating job title:`, error);
    } else {
        console.log(`[ChatTitler][${jobId}] Successfully updated title to: "${title}"`);
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { job_id, user_parts } = await req.json();
    if (!job_id || !user_parts) {
      throw new Error("Missing required parameters: job_id or user_parts.");
    }
    console.log(`[ChatTitler][${job_id}] Tool invoked.`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const title = await generateTitle(ai, user_parts);
    await updateJobTitle(supabase, job_id, title);

    return new Response(JSON.stringify({ success: true, title: title }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ChatTitler] Tool Error:", error);
    // Return a success response even on error to avoid breaking any potential await chains.
    // The error is logged for debugging, but the main agent flow should not be affected.
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200, 
    });
  }
});