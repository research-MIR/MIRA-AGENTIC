import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { model_description, set_description, selected_model_id, user_id, auto_approve } = await req.json();
    if (!model_description || !selected_model_id || !user_id) {
      throw new Error("model_description, selected_model_id, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Step 1: Generate the detailed prompt
    console.log("Step 1: Generating detailed prompt...");
    const { data: promptData, error: promptError } = await supabase.functions.invoke('MIRA-AGENT-tool-generate-model-prompt', {
        body: { model_description, set_description }
    });
    if (promptError) throw new Error(`Prompt generation failed: ${promptError.message}`);
    const finalPrompt = promptData.final_prompt;
    console.log("Generated Prompt:", finalPrompt);

    // Step 2: Generate 4 base images
    console.log("Step 2: Generating base images...");
    const { data: modelDetails, error: modelError } = await supabase
        .from('mira-agent-models')
        .select('provider')
        .eq('model_id_string', selected_model_id)
        .single();
    if (modelError) throw new Error(`Could not find model details for ${selected_model_id}`);
    
    const provider = modelDetails.provider.toLowerCase().replace(/[^a-z0-9.-]/g, '');
    let imageGenTool = '';
    if (provider === 'google') {
        imageGenTool = 'MIRA-AGENT-tool-generate-image-google';
    } else if (provider === 'fal.ai') {
        imageGenTool = 'MIRA-AGENT-tool-generate-image-fal-seedream';
    } else {
        throw new Error(`Unsupported provider for model generation: ${provider}`);
    }

    const { data: generationResult, error: generationError } = await supabase.functions.invoke(imageGenTool, {
        body: {
            prompt: finalPrompt,
            number_of_images: 4,
            model_id: selected_model_id,
            invoker_user_id: user_id,
            size: '1024x1024' // For now, hardcode to 1:1 for consistency
        }
    });
    if (generationError) throw new Error(`Image generation failed: ${generationError.message}`);

    const allImages = generationResult.images.map((img: any) => ({ id: img.storagePath, url: img.publicUrl }));
    console.log("Generated 4 base images.");

    if (auto_approve) {
        console.log("Step 3: Auto-approving best image...");
        const { data: qaData, error: qaError } = await supabase.functions.invoke('MIRA-AGENT-tool-quality-assurance-model', {
            body: { 
                image_urls: allImages.map((img: any) => img.url),
                model_description: model_description,
                set_description: set_description
            }
        });
        if (qaError) {
            console.error("Quality assurance step failed, returning all images as a fallback.", qaError);
            return new Response(JSON.stringify({ images: allImages }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            });
        }
        const bestImage = allImages[qaData.best_image_index];
        console.log(`AI selected image at index ${qaData.best_image_index}.`);
        return new Response(JSON.stringify({ images: [bestImage] }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    } else {
        console.log("Step 3: Manual approval required. Returning all images.");
        return new Response(JSON.stringify({ images: allImages }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

  } catch (error) {
    console.error("[GenerateModelOrchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});