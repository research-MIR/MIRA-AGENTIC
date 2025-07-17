import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    
    // Find the bucket name. It's usually after '/object/public/' or '/object/v1/'.
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Invalid Supabase storage URL format: ${publicUrl}`);
    }
    
    const bucketName = pathSegments[objectSegmentIndex + 2];
    const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));

    if (!bucketName || !filePath) {
        throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
    }

    console.log(`[Downloader] Attempting to download from bucket: '${bucketName}', path: '${filePath}'`);

    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) {
        throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    }
    return data;
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { job_id, final_image_url, job_type = 'bitstudio' } = await req.json();
  if (!job_id || !final_image_url) throw new Error("job_id and final_image_url are required.");
  
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[Compositor-Inpaint][${job_id}]`;
  console.log(`${logPrefix} Job started. Type: ${job_type}`);

  const tableName = job_type === 'bitstudio' ? 'mira-agent-bitstudio-jobs' : 'mira-agent-inpainting-jobs';

  try {
    const { data: job, error: fetchError } = await supabase
      .from(tableName)
      .select('metadata, user_id')
      .eq('id', job_id)
      .single();
    if (fetchError) throw fetchError;

    const metadata = job.metadata || {};
    const { full_source_image_url, bbox } = metadata;

    if (!full_source_image_url || !bbox) {
        console.warn(`${logPrefix} Job is missing metadata for compositing (full_source_image_url or bbox). Assuming it's a legacy job and skipping composition.`);
        await supabase.from(tableName).update({ status: 'complete', final_image_url: final_image_url }).eq('id', job_id);
        return new Response(JSON.stringify({ success: true, message: "Legacy job finalized without composition." }), { headers: corsHeaders });
    }

    console.log(`${logPrefix} Downloading assets for composition...`);
    console.log(`${logPrefix} Source URL to download: ${full_source_image_url}`);
    console.log(`${logPrefix} Patch URL to download: ${final_image_url}`);

    const [sourceBlob, inpaintedPatchResponse] = await Promise.all([
        downloadFromSupabase(supabase, full_source_image_url),
        fetch(final_image_url)
    ]);

    if (!inpaintedPatchResponse.ok) throw new Error(`Failed to download inpainted patch: ${inpaintedPatchResponse.statusText}`);

    const [sourceImage, inpaintedPatchImg] = await Promise.all([
        ISImage.decode(await sourceBlob.arrayBuffer()),
        ISImage.decode(await inpaintedPatchResponse.arrayBuffer())
    ]);

    console.log(`${logPrefix} Compositing final image...`);
    
    sourceImage.composite(inpaintedPatchImg, bbox.x, bbox.y);

    const finalImageBuffer = await sourceImage.encode(0); // 0 for PNG
    const finalFilePath = `${job.user_id}/vto-final/${Date.now()}_final_composite.png`;
    
    const { error: uploadError } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(finalFilePath, finalImageBuffer, { contentType: 'image/png', upsert: true });
    if (uploadError) throw uploadError;

    const { data: { publicUrl: finalPublicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);
    console.log(`${logPrefix} Composition complete. Final URL: ${finalPublicUrl}`);

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
        
        const newQaReportObject = { 
            timestamp: new Date().toISOString(), 
            report: verificationResult,
            failed_image_url: finalPublicUrl
        };

        await supabase.from(tableName).update({ 
            status: 'awaiting_fix',
            metadata: {
                ...job.metadata,
                qa_history: [...qaHistory, newQaReportObject]
            }
        }).eq('id', job_id);

        supabase.functions.invoke('MIRA-AGENT-fixer-orchestrator', { 
            body: { 
                job_id,
                qa_report_object: newQaReportObject 
            } 
        }).catch(console.error);
        console.log(`${logPrefix} Fixer orchestrator invoked for job.`);

    } else {
        console.log(`${logPrefix} QA passed or was skipped. Finalizing job as complete.`);
        const finalMetadata = { ...job.metadata, verification_result: verificationResult };
        
        const updatePayload: any = { 
            status: 'complete', 
            final_image_url: finalPublicUrl, 
            metadata: finalMetadata 
        };

        if (tableName === 'mira-agent-inpainting-jobs') {
            updatePayload.final_result = { publicUrl: finalPublicUrl };
            delete updatePayload.final_image_url;
        }

        await supabase.from(tableName).update(updatePayload).eq('id', job_id);
    }

    return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from(tableName).update({ status: 'failed', error_message: `Compositor failed: ${error.message}` }).eq('id', job_id);
    
    const { data: failedJob } = await supabase.from(tableName).select('metadata').eq('id', job_id).single();
    if (failedJob?.metadata?.batch_pair_job_id) {
        console.log(`${logPrefix} Propagating failure to parent pair job: ${failedJob.metadata.batch_pair_job_id}`);
        await supabase.from('mira-agent-batch-inpaint-pair-jobs')
            .update({ status: 'failed', error_message: `Compositor failed: ${error.message}` })
            .eq('id', failedJob.metadata.batch_pair_job_id);
    }

    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});