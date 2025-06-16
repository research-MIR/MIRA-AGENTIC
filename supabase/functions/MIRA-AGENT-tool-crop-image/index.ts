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

    // The box is normalized to 1000x1000. We need to scale it to the image dimensions.
    const [y_min, x_min, y_max, x_max] = box;
    const cropX = Math.floor((x_min / 1000) * image.width);
    const cropY = Math.floor((y_min / 1000) * image.height);
    const cropWidth = Math.floor(((x_max - x_min) / 1000) * image.width);
    const cropHeight = Math.floor(((y_max - y_min) / 1000) * image.height);

    image.crop(cropX, cropY, cropWidth, cropHeight);

    const croppedImageBuffer = await image.encode(0); // 0 for PNG

    // Upload the cropped image
    const croppedFilename = `cropped_${Date.now()}_${storagePath.split('/').pop()}`;
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