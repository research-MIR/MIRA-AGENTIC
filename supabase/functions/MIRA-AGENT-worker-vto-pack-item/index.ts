import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image as ISImage } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { decodeBase64, encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import imageSize from "https://esm.sh/image-size";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const TEMP_UPLOAD_BUCKET = 'mira-agent-user-uploads';
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const MAX_IMAGE_DIMENSION = 1024;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- Utility Functions ---

function parseStorageURL(url: string) {
    const u = new URL(url);
    const pathSegments = u.pathname.split('/');
    const objectSegmentIndex = pathSegments.indexOf('object');
    if (objectSegmentIndex === -1 || objectSegmentIndex + 2 >= pathSegments.length) {
        throw new Error(`Invalid Supabase storage URL format: ${url}`);
    }
    const bucket = pathSegments[objectSegmentIndex + 2];
    const path = decodeURIComponent(pathSegments.slice(objectSegmentIndex + 3).join('/'));
    return { bucket, path };
}

async function downloadFromSupabase(supabase: SupabaseClient, publicUrl: string): Promise<Blob> {
    const { bucket, path } = parseStorageURL(publicUrl);
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) throw new Error(`Failed to download from Supabase storage (${path}): ${error.message}`);
    return data;
}

async function uploadBuffer(buffer: Uint8Array, supabase: SupabaseClient, userId: string, filename: string) {
  const path = `tmp/${userId}/${Date.now()}-${filename}`;
  const { error } = await supabase.storage.from(TEMP_UPLOAD_BUCKET).upload(
    path,
    buffer,
    { contentType: "image/png" },
  );
  if (error) throw error;
  const { data } = await supabase.storage.from(TEMP_UPLOAD_BUCKET)
    .createSignedUrl(path, 3600); // 1 hour TTL
  if (!data || !data.signedUrl) throw new Error("Failed to create signed URL for temporary file.");
  return data.signedUrl;
}

const blobToBase64 = async (blob: Blob): Promise<string> => {
    const buffer = await blob.arrayBuffer();
    return encodeBase64(buffer);
};

const bufferToBase64 = (buffer: Uint8Array): string => encodeBase64(buffer);

// --- State Machine Logic ---

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
    const { data: job, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('id', pair_job_id).single();
    if (fetchError) throw fetchError;

    const step = job.metadata?.google_vto_step || 'start';
    console.log(`${logPrefix} Current step: ${step}`);

    switch (step) {
      case 'start':
        await handleStart(supabase, job, logPrefix);
        break;
      case 'generate_step_1':
        await handleGenerateStep(supabase, job, 15, 'generate_step_2', logPrefix);
        break;
      case 'generate_step_2':
        await handleGenerateStep(supabase, job, 30, 'generate_step_3', logPrefix);
        break;
      case 'generate_step_3':
        await handleGenerateStep(supabase, job, 55, 'quality_check', logPrefix);
        break;
      case 'quality_check':
        await handleQualityCheck(supabase, job, logPrefix);
        break;
      case 'compositing':
        await handleCompositing(supabase, job, logPrefix);
        break;
      default:
        throw new Error(`Unknown step: ${step}`);
    }

    return new Response(JSON.stringify({ success: true, message: `Step '${step}' processed.` }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: error.message }).eq('id', pair_job_id);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});

async function handleStart(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Step 1: Getting bounding box for person image.`);
  const { data: bboxData, error: bboxError } = await supabase.functions.invoke('MIRA-AGENT-orchestrator-bbox', {
      body: { image_url: job.source_person_image_url }
  });
  if (bboxError) throw bboxError;
  
  const personBox = bboxData.person;
  if (!personBox || personBox.length !== 4) {
      throw new Error("Orchestrator did not return a valid bounding box array.");
  }
  console.log(`${logPrefix} Bounding box received.`);

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
  const croppedPersonBuffer = await croppedPersonImage.encode(0);
  const croppedPersonUrl = await uploadBuffer(croppedPersonBuffer, supabase, job.user_id, 'cropped_person.png');
  console.log(`${logPrefix} Cropped person image uploaded to temp storage.`);

  let garmentImage = await ISImage.decode(await garmentBlob.arrayBuffer());
  if (garmentImage.width > MAX_IMAGE_DIMENSION || garmentImage.height > MAX_IMAGE_DIMENSION) {
    garmentImage.resize(garmentImage.width > garmentImage.height ? MAX_IMAGE_DIMENSION : ISImage.RESIZE_AUTO, garmentImage.height > garmentImage.width ? MAX_IMAGE_DIMENSION : ISImage.RESIZE_AUTO);
    console.log(`${logPrefix} Garment image resized.`);
  }
  const garmentBase64 = bufferToBase64(await garmentImage.encode(0));
  console.log(`${logPrefix} Garment image encoded and will be stored in metadata.`);

  await supabase.from('mira-agent-bitstudio-jobs').update({
    status: 'processing',
    metadata: { 
        ...job.metadata, 
        bbox, 
        cropped_person_url: croppedPersonUrl, 
        garment_image_base64: garmentBase64,
        google_vto_step: 'generate_step_1' 
    }
  }).eq('id', job.id);

  await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: job.id } });
}

async function handleGenerateStep(supabase: SupabaseClient, job: any, sampleStep: number, nextStep: string, logPrefix: string) {
  console.log(`${logPrefix} Generating variation with ${sampleStep} steps.`);
  
  const { garment_image_base64, cropped_person_url } = job.metadata;
  if (!garment_image_base64 || !cropped_person_url) {
      throw new Error("Missing required metadata: garment_image_base64 or cropped_person_url");
  }

  const personBlob = await downloadFromSupabase(supabase, cropped_person_url);
  let personImage = await ISImage.decode(await personBlob.arrayBuffer());
  if (personImage.width > MAX_IMAGE_DIMENSION || personImage.height > MAX_IMAGE_DIMENSION) {
    personImage.resize(personImage.width > personImage.height ? MAX_IMAGE_DIMENSION : ISImage.RESIZE_AUTO, personImage.height > personImage.width ? MAX_IMAGE_DIMENSION : ISImage.RESIZE_AUTO);
    console.log(`${logPrefix} Person image resized for this step.`);
  }
  const personBase64 = bufferToBase64(await personImage.encode(0));

  const { data, error } = await supabase.functions.invoke('MIRA-AGENT-tool-virtual-try-on', {
    body: {
      person_image_base64: personBase64,
      garment_image_base64: garment_image_base64,
      sample_count: 1,
      sample_step: sampleStep
    }
  });
  if (error) throw error;
  if (!data.generatedImages || data.generatedImages.length === 0) throw new Error(`VTO tool did not return an image for step ${sampleStep}`);

  const newVariation = data.generatedImages[0];
  const currentVariations = job.metadata.generated_variations || [];

  await supabase.from('mira-agent-bitstudio-jobs').update({
    metadata: { ...job.metadata, generated_variations: [...currentVariations, newVariation], google_vto_step: nextStep }
  }).eq('id', job.id);

  console.log(`${logPrefix} Step ${sampleStep} complete. Advancing to ${nextStep}.`);
  await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: job.id } });
}

async function handleQualityCheck(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Performing quality check on 3 variations.`);
  const { generated_variations, garment_image_base64 } = job.metadata;
  if (!generated_variations || generated_variations.length < 3) throw new Error("Not enough variations generated for quality check.");
  if (!garment_image_base64) throw new Error("Missing garment_image_base64 in metadata for quality check.");

  const personBlob = await downloadFromSupabase(supabase, job.source_person_image_url);

  const { data: qaData, error: qaError } = await supabase.functions.invoke('MIRA-AGENT-tool-vto-quality-checker', {
    body: {
      original_person_image_base64: await blobToBase64(personBlob),
      reference_garment_image_base64: garment_image_base64,
      generated_images_base64: generated_variations.map((img: any) => img.base64Image)
    }
  });
  if (qaError) throw qaError;
  
  console.log(`${logPrefix} QA complete. Best image index: ${qaData.best_image_index}.`);

  await supabase.from('mira-agent-bitstudio-jobs').update({
    metadata: { ...job.metadata, qa_best_index: qaData.best_image_index, qa_reasoning: qaData.reasoning, google_vto_step: 'compositing' }
  }).eq('id', job.id);

  await supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', { body: { pair_job_id: job.id } });
}

async function handleCompositing(supabase: SupabaseClient, job: any, logPrefix: string) {
  console.log(`${logPrefix} Compositing best result.`);
  const { bbox, generated_variations, qa_best_index } = job.metadata;
  if (!bbox || !generated_variations || qa_best_index === undefined) throw new Error("Missing data for compositing.");

  const bestVtoPatchBase64 = generated_variations[qa_best_index].base64Image;
  const vtoPatchBuffer = decodeBase64(bestVtoPatchBase64);
  let vtoPatchImage = await ISImage.decode(vtoPatchBuffer);

  const personBlob = await downloadFromSupabase(supabase, job.source_person_image_url);
  const personImage = await ISImage.decode(await personBlob.arrayBuffer());

  const cropAmount = 4;
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

  const finalImageBuffer = await finalImage.encode(0);
  if (!finalImageBuffer || finalImageBuffer.length === 0) {
      throw new Error("Failed to encode the final composite image.");
  }
  const finalFilePath = `${job.user_id}/vto-packs/${Date.now()}_final_composite.png`;
  await supabase.storage.from(GENERATED_IMAGES_BUCKET).upload(finalFilePath, finalImageBuffer, { contentType: 'image/png', upsert: true });
  
  const { data: urlData, error: urlError } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(finalFilePath);
  if (urlError) throw new Error(`Failed to get public URL after upload: ${urlError.message}`);
  const publicUrl = urlData.publicUrl;

  await supabase.from('mira-agent-bitstudio-jobs').update({
      status: 'complete',
      final_image_url: publicUrl,
      metadata: { ...job.metadata, google_vto_step: 'done' }
  }).eq('id', job.id);

  console.log(`${logPrefix} Job finished successfully. Final URL: ${publicUrl}`);
}