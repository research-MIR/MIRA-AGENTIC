import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import JSZip from 'npm:jszip@3.10.1';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const EXPORT_BUCKET = 'mira-agent-exports';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to sanitize strings for use as filenames
const sanitize = (str: string) => str.replace(/[^a-z0-9_.-]/gi, '_').substring(0, 50);

// Helper to download a file from Supabase Storage
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
        return null; // Return null on failure to avoid crashing the whole zip process
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { pack_id, user_id, export_structure } = await req.json();
    if (!pack_id || !user_id || !export_structure) {
      throw new Error("pack_id, user_id, and export_structure are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const logPrefix = `[PackExporter][${pack_id}]`;
    console.log(`${logPrefix} Starting export with structure: ${export_structure}`);

    // 1. Fetch all relevant jobs for the pack
    const { data: jobs, error: jobsError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('id, status, final_image_url, source_person_image_url, source_garment_image_url, metadata')
      .eq('vto_pack_job_id', pack_id)
      .eq('user_id', user_id)
      .in('status', ['complete', 'done']);
    
    if (jobsError) throw jobsError;
    if (!jobs || jobs.length === 0) throw new Error("No completed jobs found in this pack to export.");
    console.log(`${logPrefix} Found ${jobs.length} completed jobs to process.`);

    const zip = new JSZip();
    const csvData = [];

    // 2. Process jobs and build zip structure
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
            case 'by_garment':
                folderPath = `By_Garment/${sanitize(garmentId)}/`;
                break;
            case 'by_model':
                folderPath = `By_Model/${sanitize(modelId)}/`;
                break;
            case 'by_pose':
                folderPath = `By_Pose/${poseId}/`;
                break;
            case 'data_export':
                folderPath = 'images/';
                break;
            case 'flat':
            default:
                folderPath = '';
                break;
        }

        const imageBuffer = await downloadFromSupabase(supabase, job.final_image_url);
        if (imageBuffer) {
            zip.file(`${folderPath}${filename}`, imageBuffer);
        }

        if (export_structure === 'data_export') {
            csvData.push({
                image_filename: filename,
                job_id: job.id,
                status: job.status,
                model_id: modelId,
                garment_id: garmentId,
                pose_prompt: posePrompt,
                final_image_url: job.final_image_url,
            });
        }
    }

    if (export_structure === 'data_export' && csvData.length > 0) {
        const header = Object.keys(csvData[0] || {}).join(',');
        const rows = csvData.map(row => Object.values(row).map(val => `"${String(val).replace(/"/g, '""')}"`).join(','));
        const csvContent = [header, ...rows].join('\n');
        zip.file('report.csv', csvContent);
    }

    console.log(`${logPrefix} Generating zip file...`);
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    // 3. Upload zip to a temporary bucket and return a signed URL
    const zipPath = `${user_id}/exports/${pack_id}-${Date.now()}.zip`;
    await supabase.storage.from(EXPORT_BUCKET).upload(zipPath, zipBlob, { contentType: 'application/zip' });
    
    const { data: signedUrlData, error: urlError } = await supabase.storage.from(EXPORT_BUCKET).createSignedUrl(zipPath, 300); // 5-minute expiry
    if (urlError) throw urlError;

    console.log(`${logPrefix} Export complete. Returning signed URL.`);
    return new Response(JSON.stringify({ downloadUrl: signedUrlData.signedUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[PackExporter] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});