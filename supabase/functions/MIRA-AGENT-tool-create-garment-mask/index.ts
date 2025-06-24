import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type, user_id } = await req.json();
    if (!image_base64 || !mime_type || !prompt || !user_id) {
      throw new Error("image_base64, mime_type, prompt, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const sourceImage = await loadImage(`data:${mime_type};base64,${image_base64}`);
    const imageDimensions = { width: sourceImage.width(), height: sourceImage.height() };

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .insert({
        user_id,
        status: 'processing',
        source_image_dimensions: imageDimensions,
        source_image_base64: image_base64,
      })
      .select('id')
      .single();

    if (insertError) throw insertError;
    const aggregationJobId = newJob.id;

    const segmentPayload = {
      image_base64,
      mime_type,
      prompt,
      reference_image_base64,
      reference_mime_type,
      aggregation_job_id: aggregationJobId,
    };

    const promises = Array(9).fill(null).map(() => 
      supabase.functions.invoke('MIRA-AGENT-tool-segment-image', { body: segmentPayload })
    );

    // Fire and forget - do not wait for the promises to resolve.
    Promise.all(promises).catch(err => {
        console.error(`[Dispatcher] Error invoking segmentation jobs for ${aggregationJobId}:`, err);
    });

    return new Response(JSON.stringify({ aggregation_job_id: aggregationJobId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[CreateGarmentMask Dispatcher] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});