import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { url } = await req.json();
    if (!url) {
      throw new Error("URL parameter is required.");
    }

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL with status: ${response.status}`);
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) {
      throw new Error("Failed to parse the HTML content.");
    }

    // Attempt to remove script and style tags for cleaner text
    doc.querySelectorAll('script, style').forEach(el => el.remove());

    // Extract text from the body, which is a simple but effective method
    const textContent = doc.body.textContent || "";

    // Clean up whitespace and limit the content length to avoid overwhelming the model
    const cleanedContent = textContent.replace(/\s\s+/g, ' ').trim();
    const truncatedContent = cleanedContent.substring(0, 8000);

    return new Response(JSON.stringify({ content: truncatedContent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})