import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = "mira-agent-user-uploads";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getMimeType(filePath: string): string | null {
    const extension = filePath.split('.').pop()?.toLowerCase();
    if (!extension) return null;
    switch (extension) {
        case 'png': return 'image/png';
        case 'jpg': case 'jpeg': return 'image/jpeg';
        case 'webp': return 'image/webp';
        case 'gif': return 'image/gif';
        case 'pdf': return 'application/pdf';
        case 'txt': return 'text/plain';
        default: return null;
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  
  try {
    const { prompt, storagePaths, userId, isDesignerMode, pipelineMode, selectedModelId, language, ratioMode, numImagesMode } = await req.json();
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    console.log("[CreateJob] Handling new job creation.");
    if (!prompt) throw new Error("A 'prompt' is required for new jobs.");
    if (!userId) throw new Error("A 'userId' is required for new jobs.");

    const userParts: Part[] = [{ text: prompt }];
    const userProvidedAssets: any[] = [];

    if (storagePaths && Array.isArray(storagePaths)) {
        for (const path of storagePaths) {
            const mimeType = getMimeType(path);
            if (mimeType) {
                const { data: fileBlob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(path);
                if (downloadError) throw new Error(`Failed to download file from storage: ${downloadError.message}`);
                const arrayBuffer = await fileBlob.arrayBuffer();
                const base64String = encodeBase64(arrayBuffer);
                const originalName = path.split('/').pop();
                userParts.push({ inlineData: { mimeType: mimeType, data: base64String, name: originalName } });
                userProvidedAssets.push({ type: 'image', storagePath: path, originalName: originalName });
            }
        }
    }
    
    console.log(`[CreateJob] Creating Asset Manifest with ${userProvidedAssets.length} items.`);
    console.log(`[CreateJob] Created userParts with ${userParts.length} parts.`);

    const { data: newJob, error: createError } = await supabase
      .from('mira-agent-jobs')
      .insert({ 
          original_prompt: prompt, 
          status: 'processing',
          user_id: userId,
          context: { 
              history: [{ role: 'user', parts: userParts }],
              user_provided_assets: userProvidedAssets,
              iteration_number: 1,
              safety_retry_count: 0,
              isDesignerMode: isDesignerMode,
              pipelineMode: pipelineMode,
              selectedModelId: selectedModelId,
              language: language || 'it',
              ratioMode: ratioMode,
              numImagesMode: numImagesMode,
              source: 'agent'
          } 
      })
      .select('id, context, original_prompt, status, created_at, updated_at, final_result, error_message, user_id')
      .single();
    
    if (createError) throw createError;
    const newJobId = newJob.id;
    console.log(`[CreateJob][${newJobId}] Job created in DB successfully.`);
    
    console.log(`[CreateJob][${newJobId}] Invoking chat titler in the background...`);
    supabase.functions.invoke('MIRA-AGENT-tool-generate-chat-title', {
      body: { job_id: newJobId, user_parts: userParts }
    }).catch(err => console.error(`[CreateJob][${newJobId}] Error invoking chat titler:`, err));

    console.log(`[CreateJob][${newJobId}] Invoking master-worker to start the conversation...`);
    supabase.functions.invoke('MIRA-AGENT-master-worker', {
        body: { job_id: newJobId }
    }).catch(err => console.error(`[CreateJob][${newJobId}] Error invoking master-worker:`, err));

    console.log(`[CreateJob][${newJobId}] Returning new job data to client.`);
    return new Response(JSON.stringify({ newJob }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(`[CreateJob] FATAL ERROR:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});