import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import JSZip from 'npm:jszip@3.10.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const EXPORT_BUCKET = 'mira-agent-exports';
const BATCH_SIZE = 100; // Fetch 100 jobs at a time

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const sanitize = (str: string) => str.replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<ArrayBuffer | null> {
    try {
        const url = new URL(publicUrl);
        const pathSegments = url.pathname.split('/');
        const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
        const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
        
        const { data, error } = await supabase.storage.from(bucketName).download(filePath);
        if (error) throw error;
        return await data.arrayBuffer();
    } catch (e) {
        console.error(`Failed to download from URL ${publicUrl}:`, e.message);
        return null;
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { export_job_id } = await req.json();
  if (!export_job_id) {
    return new Response(JSON.stringify({ error: "export_job_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[PackExportWorker][${export_job_id}]`;

  try {
    console.log(`${logPrefix} Starting worker.`);
    await supabase.from('mira-agent-export-jobs').update({ status: 'processing' }).eq('id', export_job_id);

    const { data: jobDetails, error: fetchError } = await supabase
      .from('mira-agent-export-jobs')
      .select('pack_id, user_id, export_structure')
      .eq('id', export_job_id)
      .single();
    if (fetchError) throw fetchError;

    const { pack_id, user_id, export_structure } = jobDetails;

    const { count: totalCount, error: countError } = await supabase
        .from('mira-agent-bitstudio-jobs')
        .select('id', { count: 'exact', head: true })
        .eq('vto_pack_job_id', pack_id)
        .eq('user_id', user_id)
        .in('status', ['complete', 'done']);
    if (countError) throw countError;

    await supabase.from('mira-agent-export-jobs').update({ total_files: totalCount || 0 }).eq('id', export_job_id);

    const zip = new JSZip();
    const csvData = [];
    let processedCount = 0;

    for (let i = 0; i < (totalCount || 0); i += BATCH_SIZE) {
        console.log(`${logPrefix} Fetching batch ${i / BATCH_SIZE + 1}...`);
        const { data: jobs, error: jobsError } = await supabase
            .from('mira-agent-bitstudio-jobs')
            .select('id, status, final_image_url, source_person_image_url, source_garment_image_url, metadata')
            .eq('vto_pack_job_id', pack_id)
            .eq('user_id', user_id)
            .in('status', ['complete', 'done'])
            .range(i, i + BATCH_SIZE - 1);
        if (jobsError) throw jobsError;

        for (const job of jobs) {
            if (!job.final_image_url) continue;

            const modelId = job.metadata?.model_generation_job_id || 'unknown_model';
            const garmentUrl = job.source_garment_image_url || 'unknown_garment';
            const garmentId = garmentUrl.split('/').pop()?.split('.')[0] || 'unknown_garment';
            const posePrompt = job.metadata?.prompt_used || 'unknown_pose';
            const poseId = sanitize(posePrompt);
            const filename = `${sanitize(modelId)}_${sanitize(garmentId)}_${poseId}.jpg`;
            let folderPath = '';

            switch (export_structure) {
                case 'by_garment': folderPath = `By_Garment/${sanitize(garmentId)}/`; break;
                case 'by_model': folderPath = `By_Model/${sanitize(modelId)}/`; break;
                case 'by_pose': folderPath = `By_Pose/${poseId}/`; break;
                case 'data_export': folderPath = 'images/'; break;
                case 'flat': default: folderPath = ''; break;
            }

            const imageBuffer = await downloadFromSupabase(supabase, job.final_image_url);
            if (imageBuffer) zip.file(`${folderPath}${filename}`, imageBuffer);

            if (export_structure === 'data_export') {
                csvData.push({ image_filename: filename, job_id: job.id, status: job.status, model_id: modelId, garment_id: garmentId, pose_prompt: posePrompt, final_image_url: job.final_image_url });
            }
        }
        processedCount += jobs.length;
        await supabase.from('mira-agent-export-jobs').update({ progress: processedCount }).eq('id', export_job_id);
    }

    if (export_structure === 'data_export' && csvData.length > 0) {
        const header = Object.keys(csvData[0] || {}).join(',');
        const rows = csvData.map(row => Object.values(row).map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));
        const csvContent = [header, ...rows].join('\n');
        zip.file('report.csv', csvContent);
    }

    console.log(`${logPrefix} Generating zip file...`);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    const zipPath = `${user_id}/exports/${pack_id}-${Date.now()}.zip`;
    await supabase.storage.from(EXPORT_BUCKET).upload(zipPath, zipBlob, { contentType: 'application/zip' });
    
    const { data: signedUrlData, error: urlError } = await supabase.storage.from(EXPORT_BUCKET).createSignedUrl(zipPath, 3600); // 1-hour expiry
    if (urlError) throw urlError;

    await supabase.from('mira-agent-export-jobs').update({ status: 'complete', download_url: signedUrlData.signedUrl }).eq('id', export_job_id);

    console.log(`${logPrefix} Export complete. Signed URL created.`);
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-export-jobs').update({ status: 'failed', error_message: error.message }).eq('id', export_job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});