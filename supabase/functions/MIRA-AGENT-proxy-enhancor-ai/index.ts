import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ENHANCOR_API_KEY = Deno.env.get('ENHANCOR_API_KEY');
const API_BASE = 'https://api.enhancor.ai/api';
const UPLOAD_BUCKET = 'enhancor-ai-uploads'; // CORRECTED BUCKET

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!ENHANCOR_API_KEY) {
      throw new Error("The ENHANCOR_API_KEY is not set in the server environment.");
    }

    const { user_id, source_image_urls, enhancor_mode, enhancor_params } = await req.json();
    if (!user_id || !source_image_urls || !Array.isArray(source_image_urls) || source_image_urls.length === 0 || !enhancor_mode) {
      throw new Error("user_id, a non-empty source_image_urls array, and enhancor_mode are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const webhookUrl = `${SUPABASE_URL}/functions/v1/MIRA-AGENT-webhook-enhancor-ai`;

    const jobCreationPromises = source_image_urls.map(async (originalImageUrl: string) => {
      const logPrefix = `[EnhancorAIProxy][${originalImageUrl.split('/').pop()}]`;
      console.log(`${logPrefix} Starting processing.`);

      // 1. Create transformed URL to get a JPEG from Supabase Storage
      const transformedUrl = `${originalImageUrl}?format=jpeg&quality=95`;
      console.log(`${logPrefix} Fetching converted image from: ${transformedUrl}`);

      // 2. Fetch the converted image data
      const response = await fetch(transformedUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch and convert image from Supabase Storage. Status: ${response.status}`);
      }
      const imageBlob = await response.blob();

      // 3. Upload the converted JPEG to a new path for a permanent record
      const convertedFilePath = `${user_id}/enhancor-sources/converted/${Date.now()}-converted.jpeg`;
      const { error: uploadError } = await supabase.storage
        .from(UPLOAD_BUCKET)
        .upload(convertedFilePath, imageBlob, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) throw uploadError;

      // 4. Get the public URL of the converted image
      const { data: { publicUrl: convertedImageUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(convertedFilePath);
      console.log(`${logPrefix} Converted image stored at: ${convertedImageUrl}`);

      // 5. Create a job record in our database
      const { data: newJob, error: insertError } = await supabase
        .from('enhancor_ai_jobs')
        .insert({
          user_id,
          source_image_url: convertedImageUrl, // Use the converted URL for Enhancor
          status: 'queued',
          enhancor_mode,
          enhancor_params,
          metadata: { original_source_url: originalImageUrl } // Store original for reference
        })
        .select('id')
        .single();
      if (insertError) throw new Error(`Failed to create job record: ${insertError.message}`);
      const jobId = newJob.id;

      // 6. Construct the API call to EnhancorAI
      let endpoint = '';
      const payload: any = {
        img_url: convertedImageUrl,
        webhookUrl: `${webhookUrl}?job_id=${jobId}`,
      };

      switch (enhancor_mode) {
        case 'portrait':
          endpoint = '/upscaler/v1/queue';
          payload.mode = enhancor_params?.mode || 'professional';
          break;
        case 'general':
          endpoint = '/image-upscaler/v1/queue';
          break;
        case 'detailed':
          endpoint = '/detailed/v1/queue';
          break;
        default:
          throw new Error(`Invalid enhancor_mode: ${enhancor_mode}`);
      }

      // 7. Call the EnhancorAI API
      console.log(`${logPrefix} Calling EnhancorAI endpoint: ${endpoint}`);
      const apiResponse = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ENHANCOR_API_KEY,
        },
        body: JSON.stringify(payload),
      });

      if (!apiResponse.ok) {
        const errorBody = await apiResponse.text();
        throw new Error(`EnhancorAI API failed with status ${apiResponse.status}: ${errorBody}`);
      }

      const result = await apiResponse.json();
      if (!result.success || !result.requestId) {
        throw new Error("EnhancorAI did not return a successful response or requestId.");
      }

      // 8. Update our job with the external ID
      await supabase
        .from('enhancor_ai_jobs')
        .update({ external_request_id: result.requestId, status: 'processing' })
        .eq('id', jobId);
      
      return { success: true, jobId };
    });

    const results = await Promise.all(jobCreationPromises);

    return new Response(JSON.stringify({ success: true, jobs: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[EnhancorAIProxy] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});