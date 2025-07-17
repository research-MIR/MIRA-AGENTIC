import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const TEMP_UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    if (publicUrl.includes('/sign/')) {
        const response = await fetch(publicUrl);
        if (!response.ok) throw new Error(`Failed to download from signed URL: ${response.statusText}`);
        return await response.blob();
    }
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) throw new Error(`Could not parse bucket name from Supabase URL: ${publicUrl}`);
    const bucketName = pathSegments[objectSegmentIndex + 2];
    const filePath = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    if (!bucketName || !filePath) throw new Error(`Could not parse bucket or path from Supabase URL: ${publicUrl}`);
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    return data;
}

async function uploadBufferToTemp(supabase: SupabaseClient, buffer: Uint8Array, userId: string, filename: string): Promise<string> {
    const filePath = `tmp/${userId}/${Date.now()}-${filename}`;
    const { error } = await supabase.storage.from(TEMP_UPLOAD_BUCKET).upload(
        filePath,
        buffer,
        { contentType: "image/png" },
    );
    if (error) throw error;
    const { data } = await supabase.storage.from(TEMP_UPLOAD_BUCKET)
        .createSignedUrl(filePath, 3600); // 1 hour TTL
    if (!data || !data.signedUrl) throw new Error("Failed to create signed URL for temporary file.");
    return data.signedUrl;
}

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(buffer);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { pair_job_id } = await req.json();
  if (!pair_job_id) {
    return new Response(JSON.stringify({ error: "pair_job_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[VTO-Pack-Worker][${pair_job_id}]`;

  try {
    console.log(`${logPrefix} Starting job.`);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'processing' }).eq('id', pair_job_id);

    const { data: job, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', pair_job_id).single();
    if (fetchError) throw fetchError;

    // Step 1: Get Bounding Box
    console.log(`${logPrefix} Step 1: Getting bounding box for person image.`);
    const { data: bboxData, error: bboxError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-bbox', {
        body: { image_url: job.source_person_image_url }
    });
    if (bboxError) throw bboxError;
    
    const personBox = bboxData.person;
    if (!personBox || personBox.length !== 4) {
        throw new Error("Orchestrator did not return a valid bounding box array.");
    }
    console.log(`${logPrefix} Bounding box received:`, personBox);

    // Step 2: Crop Image
    console.log(`${logPrefix} Step 2: Cropping person image.`);
    const [personBlob, garmentBlob] = await Promise.all([
        downloadFromSupabase(supabase, job.source_person_image_url),
        downloadFromSupabase(supabase, job.source_garment_image_url)
    ]);
    const personImage = await ISImage.decode(await personBlob.arrayBuffer());
    const { width: originalWidth, height: originalHeight } = personImage;

    const abs_x = Math.floor((personBox[1] / 1000) * originalWidth);
    const abs_y = Math.floor((personBox[0] / 1000) * originalHeight);
    const abs_width = Math.ceil(((personBox[3] - personBox[1]) / 1000) * originalWidth);
    const abs_height = Math.ceil(((personBox[2] - personBox[0]) / 1000) * originalHeight);

    const bbox = { x: abs_x, y: abs_y, width: abs_width, height: abs_height };
    
    const croppedPersonImage = personImage.clone().crop(bbox.x, bbox.y, bbox.width, bbox.height);
    const croppedPersonBuffer = await croppedPersonImage.encode(0); // PNG
    const croppedPersonUrl = await uploadBufferToTemp(supabase, croppedPersonBuffer, job.user_id, 'cropped_person.png');
    console.log(`${logPrefix} Cropped person image uploaded to temp storage: ${croppedPersonUrl}`);

    // Step 3: Run VTO on the cropped image to get 3 samples
    console.log(`${logPrefix} Step 3: Running VTO on cropped image to get 3 samples.`);
    const { data: vtoResult, error: vtoError } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
        body: {
            person_image_url: croppedPersonUrl,
            garment_image_url: job.source_garment_image_url,
            sample_count: 3
        }
    });
    if (vtoError) throw vtoError;
    const generatedImages = vtoResult.generatedImages;
    if (!generatedImages || generatedImages.length === 0) throw new Error("VTO tool did not return any images.");
    console.log(`${logPrefix} VTO successful, received ${generatedImages.length} samples.`);

    // Step 4: Quality Check
    console.log(`${logPrefix} Step 4: Invoking Quality Checker.`);
    const { data: qaData, error: qaError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-quality-checker', {
        body: {
            original_person_image_base64: await blobToBase64(personBlob),
            reference_garment_image_base64: await blobToBase64(garmentBlob),
            generated_images_base64: generatedImages.map((img: any) => img.base64Image)
        }
    });
    if (qaError) throw qaError;
    const bestImageIndex = qaData.best_image_index;
    console.log(`${logPrefix} Quality Checker selected best image at index: ${bestImageIndex}. Reasoning: "${qaData.reasoning}"`);

    // Step 5: Composite the best result
    console.log(`${logPrefix} Step 5: Compositing best result.`);
    const bestVtoPatchBuffer = decodeBase64(generatedImages[bestImageIndex].base64Image);
    let vtoPatchImage = await ISImage.decode(bestVtoPatchBuffer);

    const cropAmount = 2;
    vtoPatchImage.crop(cropAmount, cropAmount, vtoPatchImage.width - (cropAmount * 2), vtoPatchImage.height - (cropAmount * 2));
    
    const targetWidth = bbox.width - (cropAmount * 2);
    const targetHeight = bbox.height - (cropAmount * 2);

    if (vtoPatchImage.width !== targetWidth || vtoPatchImage.height !== targetHeight) {
        vtoPatchImage.resize(targetWidth, targetHeight);
    }

    const pasteX = bbox.x + cropAmount;
    const pasteY = bbox.y + cropAmount;

    const finalImage = personImage.clone();
    finalImage.composite(vtoPatchImage, pasteX, pasteY);
    console.log(`${logPrefix} Composition complete.`);

    // Step 6: Finalize
    console.log(`${logPrefix} Step 6: Uploading final image and updating job.`);
    const finalImageBuffer = await finalImage.encode(0);
    const finalFilePath = `${job.user_id}/vto-packs/${Date.now()}_final_composite.png`;
    await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(finalFilePath, finalImageBuffer, { contentType: 'image/png', upsert: true });
    
    const { data: urlData, error: urlError } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);
    if (urlError) throw new Error(`Failed to get public URL after upload: ${urlError.message}`);
    if (!urlData || !urlData.publicUrl) throw new Error("Upload succeeded but did not return a public URL.");
    const publicUrl = urlData.publicUrl;

    await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'complete',
        final_image_url: publicUrl,
        metadata: { ...job.metadata, bbox, cropped_person_url: croppedPersonUrl, qa_best_index: bestImageIndex, qa_reasoning: qaData.reasoning }
    }).eq('id', pair_job_id);

    console.log(`${logPrefix} Job finished successfully. Final URL: ${publicUrl}`);
    return new Response(JSON.stringify({ success: true, finalImageUrl: publicUrl }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', pair_job_id);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});