import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { base_model_url, pose_prompt, pose_image_url } = await req.json();
    console.log(`[MockPoseGenerator] Received request. Base: ${base_model_url}, Prompt: ${pose_prompt}, Pose Image: ${pose_image_url}`);

    // In this mock function, we simply return the base model URL as the "generated" image.
    // This simulates a successful generation without any actual processing.
    const mockResult = {
      output_image_url: base_model_url,
    };

    return new Response(JSON.stringify(mockResult), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[MockPoseGenerator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});