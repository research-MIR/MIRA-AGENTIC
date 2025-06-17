import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function extractJson(text: string): any {
    // First, try to find a JSON block within markdown code fences
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        try {
            return JSON.parse(match[1]);
        } catch (e) {
            // If parsing the extracted block fails, fall through to parse the whole text
            console.warn("Failed to parse extracted JSON block, falling back to full text. Error:", e.message);
        }
    }
    
    // If no block is found or parsing it fails, try to parse the entire text
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Final attempt to parse text as JSON failed.", e.message);
        // Return a structured error instead of throwing, so the caller can handle it
        return { error: "Failed to parse text as JSON.", details: e.message, raw_text: text };
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { text_to_parse } = await req.json();
    if (typeof text_to_parse !== 'string') {
      throw new Error("Missing or invalid 'text_to_parse' string in request body.");
    }

    const parsedJson = extractJson(text_to_parse);

    return new Response(JSON.stringify(parsedJson), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[JSON-Parser-Tool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});