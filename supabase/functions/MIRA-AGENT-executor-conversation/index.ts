import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const systemPrompt = `You are Mira, a helpful AI assistant. Your task is to synthesize a final, user-friendly response in Italian based on the provided conversation history. The history may include raw data from tools. Do not mention the tools or the data structure. Just give a natural, conversational answer that directly addresses the user's original request.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { history } = await req.json();
    if (!history) {
      throw new Error("Missing 'history' in request body");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const result = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: history,
      config: {
        systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
      }
    });

    const finalReply = result.text;
    return new Response(JSON.stringify({ reply: finalReply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Conversation Executor Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});