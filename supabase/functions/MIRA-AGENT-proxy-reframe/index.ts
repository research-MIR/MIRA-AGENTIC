import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function getBase64FromUrl(supabase: SupabaseClient, url: string): Promise<string> {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));

    const { data: blob, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw error;

    const buffer = await blob.arrayBuffer();
    return encodeBase64(buffer);
}

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
        vto_pack_job_id,
        vto_pair_job_id,
        source
    } = await req.json();

    if (!user_id || (!base_image_base64 && !base_image_url) || !aspect_ratio) {
      throw new Error("user_id, aspect_ratio, and either base_image_base64 or base_image_url are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    let finalBaseImageBase64 = base_image_base64;
    if (base_image_url) {
        finalBaseImageBase64 = await getBase64FromUrl(supabase, base_image_url);
    }

    let finalMaskImageBase64 = mask_image_base64;
    if (mask_image_url) {
        finalMaskImageBase64 = await getBase64FromUrl(supabase, mask_image_url);
    }

    const uploadFile = async (base64: string, filename: string) => {
      const filePath = `${user_id}/reframe-sources/${Date.now()}-${filename}`;
      const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(filePath, decodeBase64(base64), { contentType: 'image/png' });
      if (error) throw error;
      const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);
      return publicUrl;
    };

    const uploaded_base_image_url = await uploadFile(finalBaseImageBase64, 'base.png');
    let uploaded_mask_image_url = null;
    if (finalMaskImageBase64) {
        uploaded_mask_image_url = await uploadFile(finalMaskImageBase64, 'mask.png');
    }

    const context = {
        source: source || 'reframe',
        base_image_url: uploaded_base_image_url,
        mask_image_url: uploaded_mask_image_url,
        prompt,
        dilation,
        steps,
        count,
        aspect_ratio,
        invert_mask: invert_mask || false,
        vto_pack_job_id: vto_pack_job_id || null,
        vto_pair_job_id: vto_pair_job_id || null,
    };

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-jobs')
      .insert({
        user_id,
        status: 'queued',
        original_prompt: `Reframe: ${prompt || 'Untitled'}`,
        context: context
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    supabase.functions.invoke('MIRA-AGENT-orchestrator-reframe', {
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