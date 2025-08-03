import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

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
        base_image_base64, 
        mask_image_base64,
        base_image_url,
        mask_image_url,
        prompt, 
        dilation, 
        steps, 
        count, 
        aspect_ratio,
        invert_mask,
        source,
        parent_recontext_job_id // New parameter
    } = await req.json();

    if (!user_id || (!base_image_base64 && !base_image_url) || !aspect_ratio) {
      throw new Error("user_id, aspect_ratio, and either base_image_base64 or base_image_url are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const uploadFile = async (base64: string, filename: string) => {
      const filePath = `${user_id}/reframe-sources/${Date.now()}-${filename}`;
      const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, decodeBase64(base64), { contentType: 'image/png' });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
      return publicUrl;
    };

    let final_base_image_url = base_image_url;
    if (base_image_base64) {
        final_base_image_url = await uploadFile(base_image_base64, 'base.png');
    }

    let final_mask_image_url = mask_image_url;
    if (mask_image_base64) {
        final_mask_image_url = await uploadFile(mask_image_base64, 'mask.png');
    }

    const context = {
        source: source || 'reframe',
        reframe_step: 'start', // Initial step for the new worker
        base_image_url: final_base_image_url,
        mask_image_url: final_mask_image_url,
        prompt,
        dilation,
        steps,
        count,
        aspect_ratio,
        invert_mask: invert_mask || false,
        parent_recontext_job_id: parent_recontext_job_id || null,
    };

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-jobs')
      .insert({
        user_id,
        status: 'processing', // Start as processing since the worker will run immediately
        original_prompt: `Reframe: ${prompt || 'Untitled'}`,
        context: context
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    supabase.functions.invoke('MIRA-AGENT-worker-reframe', {
      body: { job_id: newJob.id }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, jobId: newJob.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[ReframeProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});