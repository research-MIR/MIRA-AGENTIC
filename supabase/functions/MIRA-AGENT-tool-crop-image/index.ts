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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_url, box, user_id } = await req.json();
    if (!image_url || !box || !user_id) {
      throw new Error("image_url, box, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Download the original image
    const url = new URL(image_url);
    const pathParts = url.pathname.split(`/public/${UPLOAD_BUCKET}/`);
    if (pathParts.length < 2) throw new Error(`Could not parse storage path from URL: ${image_url}`);
    const storagePath = decodeURIComponent(pathParts[1]);
    
    const { data: blob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(storagePath);
    if (downloadError) throw new Error(`Supabase download failed for path ${storagePath}: ${downloadError.message}`);

    const imageBuffer = await blob.arrayBuffer();
    const image = await Image.decode(imageBuffer);
    const { width, height } = image;

    // The box is normalized to 1000x1000. We need to map it to the image's coordinate space,
    // accounting for the image's aspect ratio by simulating the image being fitted into a square.
    const [y_min_norm, x_min_norm, y_max_norm, x_max_norm] = box;

    let cropX, cropY, cropWidth, cropHeight;

    if (width >= height) {
      // Image is landscape or square. It's scaled based on width.
      const scale = width / 1000;
      const y_offset = (width - height) / 2;
      
      cropX = x_min_norm * scale;
      cropY = y_min_norm * scale - y_offset;
      cropWidth = (x_max_norm - x_min_norm) * scale;
      cropHeight = (y_max_norm - y_min_norm) * scale;
    } else {
      // Image is portrait. It's scaled based on height.
      const scale = height / 1000;
      const x_offset = (height - width) / 2;

      cropX = x_min_norm * scale - x_offset;
      cropY = y_min_norm * scale;
      cropWidth = (x_max_norm - x_min_norm) * scale;
      cropHeight = (y_max_norm - y_min_norm) * scale;
    }

    // Clamp values to be within image bounds to prevent errors
    const finalCropX = Math.max(0, cropX);
    const finalCropY = Math.max(0, cropY);
    const finalCropWidth = Math.min(width - finalCropX, cropWidth);
    const finalCropHeight = Math.min(height - finalCropY, cropHeight);

    image.crop(Math.floor(finalCropX), Math.floor(finalCropY), Math.floor(finalCropWidth), Math.floor(finalCropHeight));

    const croppedImageBuffer = await image.encode(0); // 0 for PNG

    // Upload the cropped image
    const originalFilename = storagePath.split('/').pop() || 'image.png';
    const croppedFilename = `cropped_${Date.now()}_${originalFilename}`;
    const croppedStoragePath = `${user_id}/${croppedFilename}`;
    
    const { error: uploadError } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .upload(croppedStoragePath, croppedImageBuffer, { contentType: 'image/png', upsert: true });

    if (uploadError) throw new Error(`Failed to upload cropped image: ${uploadError.message}`);

    const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(croppedStoragePath);

    return new Response(JSON.stringify({ success: true, cropped_image_url: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[CropTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});