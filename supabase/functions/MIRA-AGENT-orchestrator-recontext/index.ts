import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { product_images_base64, user_scene_prompt } = await req.json();
    if (!product_images_base64 || !user_scene_prompt) {
      throw new Error("product_images_base64 and user_scene_prompt are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Step 1: Call the prompt helper to get the detailed description and final prompt
    console.log("[RecontextOrchestrator] Calling prompt helper...");
    const { data: promptData, error: helperError } = await supabase.functions.invoke('MIRA-AGENT-tool-recontext-prompt-helper', {
      body: { product_images_base64, user_scene_prompt }
    });
    if (helperError) throw new Error(`Prompt helper failed: ${helperError.message}`);
    console.log("[RecontextOrchestrator] Prompt helper successful.");

    const { product_description, final_prompt } = promptData;

    // Step 2: Call the image generation tool with the enhanced data
    console.log("[RecontextOrchestrator] Calling image generation tool...");
    const { data: imageData, error: generationError } = await supabase.functions.invoke('MIRA-AGENT-tool-product-recontext', {
      body: {
        product_images_base64,
        prompt: final_prompt,
        product_description: product_description
      }
    });
    if (generationError) throw new Error(`Image generation failed: ${generationError.message}`);
    console.log("[RecontextOrchestrator] Image generation successful.");

    // Step 3: Return the final image data along with the generated description
    return new Response(JSON.stringify({
      base64Image: imageData.base64Image,
      mimeType: imageData.mimeType,
      productDescription: product_description,
      finalPromptUsed: final_prompt
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[RecontextOrchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});