import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = "mira-agent-user-uploads";

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('context, user_id').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const history = job.context?.history || [];
    
    const lastImagePart = [...history].reverse()
        .flatMap(turn => turn.parts)
        .find(part => part.inlineData);

    if (!lastImagePart || !lastImagePart.inlineData) {
        throw new Error("Could not find an image in the history to refine.");
    }

    const { mimeType, data: base64Data } = lastImagePart.inlineData;
    const fileBuffer = decodeBase64(base64Data);
    const tempFilePath = `temp/${job_id}/${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .upload(tempFilePath, fileBuffer, { contentType: mimeType });
    
    if (uploadError) throw new Error(`Failed to temporarily upload image for refinement: ${uploadError.message}`);

    const { data: urlData } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(tempFilePath);
    const publicUrl = urlData.publicUrl;

    console.log(`[RefinementExecutor][${job_id}] Temporarily uploaded image to ${publicUrl}. Calling final tool.`);

    const { error: toolError } = await supabase.functions.invoke('MIRA-AGENT-tool-refine-image-comfyui', {
        body: {
            image_url: publicUrl,
            prompt,
            upscale_factor,
            main_agent_job_id: job_id,
            invoker_user_id: job.user_id
        }
    });
    if (toolError) throw toolError;

    console.log(`[RefinementExecutor][${job_id}] Pausing main job and awaiting refinement result.`);
    await supabase.from('mira-agent-jobs').update({ status: 'awaiting_refinement' }).eq('id', job_id);
    
    return new Response(JSON.stringify({ success: true, message: "Refinement job started. Main agent is now paused." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(`[RefinementExecutor] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});