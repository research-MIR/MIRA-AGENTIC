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
    const { job_id, prompt, upscale_factor } = await req.json();
    if (!job_id || !prompt || !upscale_factor) {
      throw new Error("Missing required parameters: job_id, prompt, or upscale_factor.");
    }
    console.log(`[RefinementExecutor][${job_id}] Invoked.`);

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('context, user_id').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const history = job.context?.history || [];
    
    let imageUrlToRefine: string | null = null;
    let imageBase64Data: string | null = null;
    let imageMimeType: string | null = 'image/png';
    let imageDataSource: 'generated' | 'uploaded' | null = null;

    // Search history in reverse to find the absolute last image, regardless of source
    for (const turn of [...history].reverse()) {
        if (turn.role === 'function' && turn.parts[0]?.functionResponse?.response?.isImageGeneration && turn.parts[0]?.functionResponse?.response?.images?.length > 0) {
            imageUrlToRefine = turn.parts[0].functionResponse.response.images[0].publicUrl;
            imageDataSource = 'generated';
            break; // Found the most recent generated image, stop searching
        }
        if (turn.role === 'user') {
            const imagePart = turn.parts.find((p: any) => p.inlineData);
            if (imagePart) {
                imageBase64Data = imagePart.inlineData.data;
                imageMimeType = imagePart.inlineData.mimeType;
                imageDataSource = 'uploaded';
                break; // Found the most recent user-uploaded image, stop searching
            }
        }
    }

    if (!imageDataSource) {
        throw new Error("Could not find any image in the conversation history to refine.");
    }

    if (imageDataSource === 'generated' && imageUrlToRefine) {
        console.log(`[RefinementExecutor][${job_id}] Found generated image URL: ${imageUrlToRefine}. Calling ComfyUI proxy with URL.`);
        
        const { error: toolError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
            body: {
                image_url: imageUrlToRefine,
                prompt_text: prompt,
                upscale_factor: upscale_factor,
                main_agent_job_id: job_id,
                invoker_user_id: job.user_id
            }
        });
        if (toolError) throw toolError;
    } else if (imageDataSource === 'uploaded' && imageBase64Data) {
        console.log(`[RefinementExecutor][${job_id}] Found user-uploaded image data. Calling ComfyUI proxy directly with base64.`);

        const { error: toolError } = await supabase.functions.invoke('MIRA-AGENT-proxy-comfyui', {
            body: {
                base64_image_data: imageBase64Data,
                mime_type: imageMimeType,
                prompt_text: prompt,
                upscale_factor: upscale_factor,
                main_agent_job_id: job_id,
                invoker_user_id: job.user_id
            }
        });
        if (toolError) throw toolError;
    } else {
        throw new Error("Image data source was identified but the corresponding data was missing.");
    }

    console.log(`[RefinementExecutor][${job_id}] Pausing main job and awaiting refinement result.`);
    await supabase.from('mira-agent-jobs').update({ status: 'awaiting_refinement' }).eq('id', job_id);
    
    return new Response(JSON.stringify({ success: true, message: "Refinement job started. Main agent is now paused." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(`[RefinementExecutor] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});