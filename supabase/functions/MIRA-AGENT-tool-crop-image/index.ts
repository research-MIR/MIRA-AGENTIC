import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

serve(async (req) => {
  const reqId = `crop-tool-${Date.now()}`;
  console.log(`[${reqId}] CropTool function invoked.`);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url, box, user_id } = await req.json();
    console.log(`[${reqId}] Received payload:`, { image_url, box, user_id });
    if (!image_url || !box || !user_id) {
      throw new Error("image_url, box, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Download the original image
    const url = new URL(image_url);
    const pathParts = url.pathname.split(`/public/${UPLOAD_BUCKET}/`);
    if (pathParts.length < 2) throw new Error(`Could not parse storage path from URL: ${image_url}`);
    const storagePath = decodeURIComponent(pathParts[1]);
    console.log(`[${reqId}] Parsed storage path: ${storagePath}`);
    
    const { data: blob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(storagePath);
    if (downloadError) throw new Error(`Supabase download failed for path ${storagePath}: ${downloadError.message}`);
    console.log(`[${reqId}] Successfully downloaded image blob. Size: ${blob.size} bytes.`);

    const imageBuffer = await blob.arrayBuffer();
    const image = await Image.decode(imageBuffer);
    console.log(`[${reqId}] Decoded original image. Dimensions: ${image.width}x${image.height}`);

    // --- New Simplified Logic ---
    // 1. Create a standard 1000x1000 canvas
    const canvas = new Image(1000, 1000);
    console.log(`[${reqId}] Created 1000x1000 canvas.`);

    // 2. Resize the original image to fit inside the 1000x1000 canvas, preserving aspect ratio
    image.contain(1000, 1000);
    console.log(`[${reqId}] Resized (contained) image to: ${image.width}x${image.height}`);

    // 3. Composite the resized image onto the center of the canvas
    const compositeX = (1000 - image.width) / 2;
    const compositeY = (1000 - image.height) / 2;
    canvas.composite(image, compositeX, compositeY);
    console.log(`[${reqId}] Composited resized image onto canvas at x:${compositeX}, y:${compositeY}`);

    // 4. Crop the 1000x1000 canvas directly using the normalized coordinates
    const [y_min, x_min, y_max, x_max] = box;
    const cropWidth = x_max - x_min;
    const cropHeight = y_max - y_min;
    console.log(`[${reqId}] Cropping canvas with box: { x: ${x_min}, y: ${y_min}, w: ${cropWidth}, h: ${cropHeight} }`);

    if (cropWidth <= 0 || cropHeight <= 0) {
        throw new Error(`Invalid bounding box dimensions resulted in a zero-size crop. W: ${cropWidth}, H: ${cropHeight}`);
    }

    canvas.crop(x_min, y_min, cropWidth, cropHeight);
    console.log(`[${reqId}] Crop complete. Final image dimensions: ${canvas.width}x${canvas.height}`);
    // --- End of New Logic ---

    const croppedImageBuffer = await canvas.encode(0); // 0 for PNG
    console.log(`[${reqId}] Encoded final image to PNG buffer. Size: ${croppedImageBuffer.byteLength} bytes.`);

    // Upload the cropped image
    const originalFilename = storagePath.split('/').pop() || 'image.png';
    const croppedFilename = `cropped_${Date.now()}_${originalFilename}`;
    const croppedStoragePath = `${user_id}/${croppedFilename}`;
    
    const { error: uploadError } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .upload(croppedStoragePath, croppedImageBuffer, { contentType: 'image/png', upsert: true });

    if (uploadError) throw new Error(`Failed to upload cropped image: ${uploadError.message}`);
    console.log(`[${reqId}] Uploaded cropped image to: ${croppedStoragePath}`);

    const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(croppedStoragePath);
    console.log(`[${reqId}] Generated public URL: ${publicUrl}`);

    return new Response(JSON.stringify({ success: true, cropped_image_url: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[${reqId}] [CropTool] Error:`, error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});