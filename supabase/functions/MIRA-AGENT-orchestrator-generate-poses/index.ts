import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to process a category of models
async function processCategory(
  supabase: SupabaseClient,
  categoryName: 'upper_body' | 'lower_body' | 'full_body',
  promptString: string | undefined,
  logPrefix: string
) {
  if (!promptString || promptString.trim() === "") {
    return [];
  }

  console.log(`${logPrefix} Parsing prompts for category: ${categoryName}`);
  const { data: parsedData, error: parseError } = await supabase.functions.invoke('MIRA-AGENT-tool-parse-multi-model-prompt', {
    body: { high_level_prompt: promptString }
  });

  if (parseError) {
    console.error(`${logPrefix} Error parsing prompts for ${categoryName}:`, parseError);
    throw new Error(`Failed to parse prompts for ${categoryName}: ${parseError.message}`);
  }

  const descriptions = parsedData.model_descriptions || [];
  console.log(`${logPrefix} Found ${descriptions.length} individual models in the '${categoryName}' category.`);

  return descriptions.map((desc: string) => ({
    model_description: desc,
    target_body_part: categoryName,
  }));
}


serve(async (req) => {
  const requestId = `orchestrator-poses-${Date.now()}`;
  const logPrefix = `[Orchestrator-Poses][${requestId}]`;

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
        // New inputs
        upper_body_models,
        lower_body_models,
        full_body_models,
        // Existing shared inputs
        set_description, 
        selected_model_id, 
        auto_approve, 
        pose_prompts, 
        user_id,
        pack_id,
        aspect_ratio,
        engine
    } = await req.json();

    if (!user_id || !pack_id || !selected_model_id || !pose_prompts) {
      throw new Error("user_id, pack_id, selected_model_id, and pose_prompts are required.");
    }
    
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const executionEngine = engine || 'comfyui';

    console.log(`${logPrefix} Processing model descriptions from all three categories.`);

    const [upperBodyModels, lowerBodyModels, fullBodyModels] = await Promise.all([
        processCategory(supabase, 'upper_body', upper_body_models, logPrefix),
        processCategory(supabase, 'lower_body', lower_body_models, logPrefix),
        processCategory(supabase, 'full_body', full_body_models, logPrefix)
    ]);

    const allModelsToCreate = [...upperBodyModels, ...lowerBodyModels, ...fullBodyModels];

    if (allModelsToCreate.length === 0) {
        return new Response(JSON.stringify({ success: true, message: "No model descriptions were provided to create." }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });
    }

    console.log(`${logPrefix} A total of ${allModelsToCreate.length} models will be created.`);

    const jobsToInsert = allModelsToCreate.map(modelData => ({
        user_id,
        pack_id,
        model_description: modelData.model_description,
        target_body_part: modelData.target_body_part, // The new field
        set_description,
        auto_approve,
        pose_prompts,
        status: 'pending',
        last_polled_at: new Date().toISOString(),
        context: {
          selectedModelId: selected_model_id,
          aspect_ratio: aspect_ratio || '1024x1024',
          execution_engine: executionEngine
        }
    }));

    console.log(`${logPrefix} Inserting ${jobsToInsert.length} new jobs into 'mira-agent-model-generation-jobs'...`);
    const { data: newJobs, error: insertError } = await supabase
      .from('mira-agent-model-generation-jobs')
      .insert(jobsToInsert)
      .select('id');

    if (insertError) throw insertError;
    
    const newJobIds = newJobs.map(j => j.id);
    console.log(`${logPrefix} ${newJobIds.length} jobs created successfully.`);

    console.log(`${logPrefix} Asynchronously invoking pollers for all new jobs.`);
    const pollerPromises = newJobIds.map(jobId => 
        supabase.functions.invoke('MIRA-AGENT-poller-model-generation', {
            body: { job_id: jobId }
        })
    );

    Promise.allSettled(pollerPromises).then(results => {
        const failedCount = results.filter(r => r.status === 'rejected').length;
        if (failedCount > 0) {
            console.error(`${logPrefix} Failed to invoke ${failedCount} pollers.`);
        } else {
            console.log(`${logPrefix} All ${newJobIds.length} pollers invoked successfully.`);
        }
    });

    return new Response(JSON.stringify({ success: true, jobIds: newJobIds }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});