import { serve } from "https://deno.land/std@0.190.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { image_url } = await req.json()
    console.log(`Analyzing image: ${image_url}`);

    // In a real scenario, you would call an external vision API here.
    // For now, we return mock structured data.
    const mockAnalysis = {
      analysis: {
        description: "A close-up shot of a plate of spaghetti carbonara on a rustic wooden table.",
        dominant_colors: ["#F5DEB3", "#8B4513", "#FFFFFF"],
        objects_detected: ["plate", "pasta", "fork", "table"],
        text_detected: null,
        quality_score: 0.92
      }
    };

    return new Response(JSON.stringify(mockAnalysis), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})