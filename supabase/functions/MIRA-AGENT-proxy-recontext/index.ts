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
    const { 
        user_id, 
        product_images_base64, 
        user_scene_prompt, 
        scene_reference_image_base64, 
        aspect_ratio 
    } = await req.json();

    if (!user_id || !product_images_base64) {
      throw new Error("user_id and product_images_base64 are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const context = {
        source: 'recontext',
        recontext_step: 'start',
        product_images_base64,
        user_scene_prompt,
        scene_reference_image_base64,
        aspect_ratio: aspect_ratio || '1:1'
    };

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-jobs')
      .insert({
        user_id,
        status: 'processing',
        original_prompt: `Recontext: ${user_scene_prompt || 'Image Analysis'}`,
        context: context
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    supabase.functions.invoke('MIRA-AGENT-worker-recontext', {
      body: { job_id: newJob.id }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[RecontextProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});