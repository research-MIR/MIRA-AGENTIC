import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image } from 'https://deno.land/x/imagescript@1.2.15/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { image_url, box, user_id } = await req.json();
    if (!image_url || !box || !user_id) {
      throw new Error("image_url, box, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const imageResponse = await fetch(image_url);
    if (!imageResponse.ok) throw new Error("Failed to download source image.");
    const imageBuffer = await imageResponse.arrayBuffer();
    
    const image = await Image.decode(imageBuffer);
    
    const [y0, x0, y1, x1] = box;
    const cropX = Math.floor((x0 / 1000) * image.width);
    const cropY = Math.floor((y0 / 1000) * image.height);
    const cropWidth = Math.ceil(((x1 - x0) / 1000) * image.width);
    const cropHeight = Math.ceil(((y1 - y0) / 1000) * image.height);

    image.crop(cropX, cropY, cropWidth, cropHeight);

    const croppedImageBuffer = await image.encode(0.9); // Encode to JPEG with 90% quality

    const filePath = `${user_id}/vto-cropped/${Date.now()}-cropped.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .upload(filePath, croppedImageBuffer, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(filePath);

    return new Response(JSON.stringify({ cropped_image_url: publicUrl }), {
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