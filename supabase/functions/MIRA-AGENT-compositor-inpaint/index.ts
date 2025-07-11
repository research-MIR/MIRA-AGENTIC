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

// (Helper functions like downloadFromSupabase and standardizeImageBuffer would be here)
// ...

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id, final_image_url, job_type = 'comfyui' } = await req.json();
  if (!job_id || !final_image_url) throw new Error("job_id and final_image_url are required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[Compositor-Inpainting][${job_id}]`;
  console.log(`${logPrefix} Job started. Type: ${job_type}`);

  try {
    // ... (The existing image composition logic would be here, creating the final image)
    // ... (For brevity, we'll assume the final image is composited and we have its public URL)
    const finalPublicUrl = "https://example.com/path/to/final_composited_image.png"; // Placeholder for the actual composited URL

    // --- NEW LOGIC STARTS HERE ---

    const { data: job, error: fetchError } = await supabase
      .from(job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs')
      .select('metadata, user_id')
      .eq('id', job_id)
      .single();
    if (fetchError) throw fetchError;

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
        // QA FAILED - INITIATE FIXER WORKFLOW
        console.log(`${logPrefix} QA failed. Handing off to Fixer Agent.`);
        
        // 1. Update original job status
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'awaiting_fix' }).eq('id', job_id);

        // 2. Create the fixer job
        const { data: fixerJob, error: createFixerError } = await supabase.from('mira-agent-fixer-jobs').insert({
            source_vto_job_id: job_id,
            status: 'pending_plan',
            initial_qa_report: verificationResult,
            retry_count: (job.metadata?.retry_count || 0) + 1
        }).select('id').single();

        if (createFixerError) throw createFixerError;

        // 3. Invoke the orchestrator
        supabase.functions.invoke('MIRA-AGENT-fixer-orchestrator', { body: { fixer_job_id: fixerJob.id } }).catch(console.error);

        console.log(`${logPrefix} Fixer job ${fixerJob.id} created and orchestrator invoked.`);

    } else {
        // QA PASSED OR WAS SKIPPED - COMPLETE THE JOB
        console.log(`${logPrefix} QA passed or was skipped. Finalizing job as complete.`);
        const finalMetadata = { ...job.metadata, verification_result: verificationResult };
        
        const updatePayload = job_type === 'bitstudio' 
            ? { status: 'complete', final_image_url: finalPublicUrl, metadata: finalMetadata }
            : { status: 'complete', final_result: { publicUrl: finalPublicUrl }, metadata: finalMetadata };

        await supabase.from(job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs')
            .update(updatePayload)
            .eq('id', job_id);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    const tableName = job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs';
    await supabase.from(tableName).update({ status: 'failed', error_message: `Compositor failed: ${error.message}` }).eq('id', job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});