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
    const body = await req.json();
    // Detailed logging to debug the issue
    console.log("[CreateGarmentMask Dispatcher] Received request body:", JSON.stringify(body, (key, value) => 
        typeof value === 'string' && value.length > 30 ? value.substring(0, 30) + '...' : value
    ));

    const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type, user_id } = body;
    
    if (!image_base64 || !mime_type || !prompt || !user_id) {
      console.error("[CreateGarmentMask Dispatcher] Validation failed. One or more required fields are missing.");
      console.error(`  - has image_base64: ${!!image_base64}`);
      console.error(`  - has mime_type: ${!!mime_type}`);
      console.error(`  - has prompt: ${!!prompt}`);
      console.error(`  - has user_id: ${!!user_id}`);
      throw new Error("image_base64, mime_type, prompt, and user_id are required.");
    }
    console.log("[CreateGarmentMask Dispatcher] All required fields are present.");

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
    console.log(`[CreateGarmentMask Dispatcher] Created aggregation job ${aggregationJobId}.`);

    const segmentPayload = {
      image_base64,
      mime_type,
      prompt,
      reference_image_base64,
      reference_mime_type,
      aggregation_job_id: aggregationJobId,
    };

    console.log(`[CreateGarmentMask Dispatcher] Invoking 9 segmentation workers for job ${aggregationJobId}...`);
    const promises = Array(9).fill(null).map(() => 
      supabase.functions.invoke('MIRA-AGENT-tool-segment-image', { body: segmentPayload })
    );

    // Fire and forget
    Promise.all(promises).catch(err => {
        console.error(`[Dispatcher] Error invoking segmentation jobs for ${aggregationJobId}:`, err);
    });

    console.log(`[CreateGarmentMask Dispatcher] Workers invoked. Returning job ID to client.`);
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