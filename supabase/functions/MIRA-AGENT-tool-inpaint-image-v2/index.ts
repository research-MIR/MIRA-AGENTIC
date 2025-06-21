import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';
const GENERATED_IMAGES_BUCKET = 'mira-generations';

// Helper to upload a file from a base64 string
async function uploadBase64(supabase: any, base64: string, mimeType: string, path: string): Promise<string> {
    const { Buffer } = await import('https://deno.land/std@0.140.0/node/buffer.ts');
    const buffer = Buffer.from(base64, 'base64');
    const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, buffer, { contentType: mimeType, upsert: true });
    if (error) throw new Error(`Storage upload failed for ${path}: ${error.message}`);
    const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
    return publicUrl;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
        full_source_image_base64, 
        cropped_source_image_base64, 
        dilated_mask_base64, 
        prompt, 
        bbox,
        user_id 
    } = await req.json();

    if (!full_source_image_base64 || !cropped_source_image_base64 || !dilated_mask_base64 || !prompt || !bbox || !user_id) {
      throw new Error("Missing one or more required parameters.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // --- Placeholder for actual inpainting on the cropped image ---
    // In a real scenario, you would call your inpainting service here,
    // passing it the cropped_source_image_base64 and a cropped version of the mask.
    // For this example, we'll simulate receiving an inpainted crop.
    // We will just return the cropped source image as if it were inpainted.
    const inpainted_crop_base64 = cropped_source_image_base64;
    // --- End of Placeholder ---

    // --- Re-compositing Logic (Server-Side) ---
    const { createCanvas, loadImage } = await import('https://deno.land/x/canvas@v1.4.1/mod.ts');
    
    const fullSourceImage = await loadImage(`data:image/png;base64,${full_source_image_base64}`);
    const inpaintedCropImage = await loadImage(`data:image/png;base64,${inpainted_crop_base64}`);

    const canvas = createCanvas(fullSourceImage.width(), fullSourceImage.height());
    const ctx = canvas.getContext('2d');

    // 1. Draw the original full-size image
    ctx.drawImage(fullSourceImage, 0, 0);

    // 2. Draw the inpainted crop on top at the correct location
    ctx.drawImage(inpaintedCropImage, bbox.x, bbox.y, bbox.width, bbox.height);

    const finalImageBuffer = canvas.toBuffer('image/png');
    
    // 3. Upload the final composited image to storage
    const filePath = `${user_id}/inpainted/${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, finalImageBuffer, { contentType: 'image/png', upsert: true });

    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);

    return new Response(JSON.stringify({ success: true, imageUrl: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[InpaintToolV2] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});