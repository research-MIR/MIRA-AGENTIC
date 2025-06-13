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
    const { jobId, prompt, storagePaths, isDesignerMode, pipelineMode, ratioMode, numImagesMode, isSilent } = await req.json();
    if (!jobId) { throw new Error("jobId is required to continue a job."); }

    console.log(`[ContinueJob][${jobId}] Received request. isSilent: ${isSilent}`);
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('*').eq('id', jobId).single();
    if (fetchError) throw fetchError;

    const history = job.context?.history || [];
    
    if (job.final_result && job.final_result.text) {
        console.log(`[ContinueJob][${jobId}] Found previous bot text response. Adding to history.`);
        history.push({ role: 'model', parts: [{ text: job.final_result.text }] });
    }

    const userParts: Part[] = [];

    if (prompt) {
        userParts.push({ text: prompt });
    }

    if (storagePaths && Array.isArray(storagePaths)) {
        for (const path of storagePaths) {
            const mimeType = getMimeType(path);
            if (mimeType) {
                console.log(`[ContinueJob][${jobId}] Downloading file from storage: ${path}`);
                const { data: fileBlob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(path);
                if (downloadError) throw new Error(`Failed to download file from storage: ${downloadError.message}`);
                
                const arrayBuffer = await fileBlob.arrayBuffer();
                const base64String = encodeBase64(arrayBuffer);

                userParts.push({
                    inlineData: {
                        mimeType: mimeType,
                        data: base64String
                    }
                });
            }
        }
    }

    const newContext = { 
        ...job.context, 
        history, 
        isDesignerMode, 
        pipelineMode,
        ratioMode,
        numImagesMode
    };

    if (userParts.length > 0) {
        if (isSilent) {
            console.log(`[ContinueJob][${jobId}] Handling silent choice. Storing in pending_user_choice.`);
            newContext.pending_user_choice = prompt;
        } else {
            history.push({ role: 'user', parts: userParts });
        }
    } else {
        console.warn(`[ContinueJob][${jobId}] No new prompt or files provided. Re-triggering without new user input.`);
    }

    console.log(`[ContinueJob][${jobId}] Updating job history and settings. Setting status to 'processing'.`);
    await supabase.from('mira-agent-jobs').update({ 
        context: newContext, 
        status: 'processing',
        final_result: null,
        error_message: null
    }).eq('id', jobId);

    console.log(`[ContinueJob][${jobId}] Invoking master-worker to continue plan.`);
    supabase.functions.invoke('MIRA-AGENT-master-worker', { body: { job_id: jobId } }).catch(console.error);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(`[ContinueJob] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});