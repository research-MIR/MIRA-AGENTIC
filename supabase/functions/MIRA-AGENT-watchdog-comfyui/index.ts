import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Log immediately upon invocation
  console.log("[ComfyUI Watchdog DEBUG] Function was successfully invoked by cron job.");

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Just return a simple success message
    const message = "Debug watchdog ran successfully.";
    console.log("[ComfyUI Watchdog DEBUG] Returning success response.");
    
    return new Response(JSON.stringify({ message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    // Log any unexpected errors during this minimal execution
    console.error("[ComfyUI Watchdog DEBUG] An unexpected error occurred:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});