import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array | null, userId: string, filename: string): Promise<string | null> {
    if (!buffer) return null;
    const filePath = `${userId}/vto-debug/${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) {
        console.error(`Storage upload failed for ${filename}: ${error.message}`);
        return null;
    }
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return publicUrl;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id, final_image_url, job_type = 'comfyui' } = await req.json();
  if (!job_id || !final_image_url) throw new Error("job_id and final_image_url are required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[Compositor-Inpainting][${job_id}]`;
  console.log(`${logPrefix} Job started. Type: ${job_type}`);

  const tableName = job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs';

  try {
    const { data: job, error: fetchError } = await supabase
      .from(tableName)
      .select('metadata, user_id')
      .eq('id', job_id)
      .single();
    if (fetchError) throw fetchError;

    // --- Image Composition Logic (Placeholder) ---
    const finalPublicUrl = final_image_url; 
    console.log(`${logPrefix} Composition complete. Final URL: ${finalPublicUrl}`);
    // --- End Composition Logic ---

    let verificationResult = null;
    if (job.metadata?.reference_image_url) {
        console.log(`${logPrefix} Reference image found. Triggering verification step.`);
        const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-verify-garment-match', {
            body: {
                original_garment_url: job.metadata.reference_image_url,
                final_generated_url: finalPublicUrl
            }
        });
        if (error) {
            console.error(`${logPrefix} Verification tool failed:`, error.message);
            verificationResult = { error: error.message, is_match: false };
        } else {
            verificationResult = data;
        }
    }

    if (verificationResult && verificationResult.is_match === false) {
        console.log(`${logPrefix} QA failed. Setting status to 'awaiting_fix' and invoking orchestrator.`);
        const qaHistory = job.metadata?.qa_history || [];
        
        const croppedDilatedMaskBuffer = decodeBase64(job.metadata.cropped_dilated_mask_base64);
        const expandedMaskUrl = await uploadBufferToStorage(supabase, croppedDilatedMaskBuffer, job.user_id, `expanded_mask_attempt_${qaHistory.length}.png`);

        const attemptDebugAssets = {
            raw_mask_url: job.metadata.raw_mask_url,
            expanded_mask_url: expandedMaskUrl,
        };

        await supabase.from(tableName).update({ 
            status: 'awaiting_fix',
            metadata: {
                ...job.metadata,
                qa_history: [...qaHistory, { 
                    timestamp: new Date().toISOString(), 
                    report: verificationResult,
                    debug_assets: attemptDebugAssets
                }]
            }
        }).eq('id', job_id);

        supabase.functions.invoke('MIRA-AGENT-fixer-orchestrator', { body: { job_id } }).catch(console.error);
        console.log(`${logPrefix} Fixer orchestrator invoked for job.`);

    } else {
        console.log(`${logPrefix} QA passed or was skipped. Finalizing job as complete.`);
        
        const croppedDilatedMaskBuffer = decodeBase64(job.metadata.cropped_dilated_mask_base64);
        const expandedMaskUrl = await uploadBufferToStorage(supabase, croppedDilatedMaskBuffer, job.user_id, `expanded_mask_final.png`);
        const finalDebugAssets = {
            raw_mask_url: job.metadata.raw_mask_url,
            expanded_mask_url: expandedMaskUrl,
        };

        const finalMetadata = { ...job.metadata, verification_result: verificationResult, debug_assets: finalDebugAssets };
        
        const updatePayload: any = { 
            status: 'complete', 
            metadata: finalMetadata 
        };

        if (tableName === 'mira-agent-inpainting-jobs') {
            updatePayload.final_result = { publicUrl: finalPublicUrl };
        } else {
            updatePayload.final_image_url = finalPublicUrl;
        }

        await supabase.from(tableName).update(updatePayload).eq('id', job_id);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from(tableName).update({ status: 'failed', error_message: `Compositor failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});