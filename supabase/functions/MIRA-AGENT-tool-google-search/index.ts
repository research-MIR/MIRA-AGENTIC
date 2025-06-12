import { serve } from "https://deno.land/std@0.190.0/http/server.ts"

const GOOGLE_API_KEY = Deno.env.get('GOOGLE_SEARCH_API');
const SEARCH_ENGINE_ID = Deno.env.get('GOOGLE_SEARCH_CX');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { query } = await req.json();
    if (!query) {
      throw new Error("Query parameter is required.");
    }

    console.log(`[GoogleSearchTool] Received query: "${query}"`);

    if (!GOOGLE_API_KEY || !SEARCH_ENGINE_ID) {
      throw new Error("Missing GOOGLE_SEARCH_API or GOOGLE_SEARCH_CX secrets.");
    }

    const params = new URLSearchParams({
      key: GOOGLE_API_KEY,
      cx: SEARCH_ENGINE_ID,
      q: query,
      num: '5'
    });

    const apiUrl = `https://www.googleapis.com/customsearch/v1?${params.toString()}`;
    console.log(`[GoogleSearchTool] Fetching URL: ${apiUrl}`);
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google Search API failed with status ${response.status}: ${errorData.error.message}`);
    }

    const searchData = await response.json();
    const results = searchData.items?.map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.snippet,
    })) || [];

    console.log(`[GoogleSearchTool] Found ${results.length} results. Returning first result: ${results[0]?.url || 'None'}`);

    return new Response(JSON.stringify({ results: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error("[GoogleSearchTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})