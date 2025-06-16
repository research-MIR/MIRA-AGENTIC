import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const UPLOAD_BUCKET = 'mira-agent-user-uploads';

async function downloadImage(supabase: SupabaseClient, imageUrl: string): Promise<Image> {
    console.log(`[CompositeTool] Downloading image from URL: ${imageUrl}`);
    let imageBuffer: ArrayBuffer;

    const bucketMatch = imageUrl.match(/\/storage\/v1\/object\/public\/([a-zA-Z0-9_-]+)\//);
    const bucketName = bucketMatch ? bucketMatch[1] : UPLOAD_BUCKET;

    if (imageUrl.includes('supabase.co')) {
        const url = new URL(imageUrl);
        const pathParts = url.pathname.split(`/public/${bucketName}/`);
        if (pathParts.length < 2) {
            throw new Error(`Could not parse Supabase storage path from URL: ${imageUrl}`);
        }
        const storagePath = decodeURIComponent(pathParts[1]);
        
        const { data: blob, error: downloadError } = await supabase.storage
            .from(bucketName)
            .download(storagePath);

        if (downloadError) {
            throw new Error(`Supabase download failed for path ${storagePath}: ${downloadError.message}`);
        }
        imageBuffer = await blob.arrayBuffer();
    } else {
        const response = await fetch(imageUrl);
        if (!response.ok) {
            throw new Error(`Failed to download image from ${imageUrl}. Status: ${response.status}`);
        }
        imageBuffer = await response.arrayBuffer();
    }
    
    return Image.decode(imageBuffer);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { base_image_url, overlay_image_url, box, user_id } = await req.json();
    if (!base_image_url || !overlay_image_url || !box || !user_id) {
      throw new Error("base_image_url, overlay_image_url, box, and user_id are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    const [baseImage, overlayImage] = await Promise.all([
        downloadImage(supabase, base_image_url),
        downloadImage(supabase, overlay_image_url)
    ]);

    const { width: baseW, height: baseH } = baseImage;
    const [y_min_norm, x_min_norm, y_max_norm, x_max_norm] = box;

    let targetPasteX, targetPasteY, targetPasteWidth, targetPasteHeight;

    if (baseW >= baseH) {
      const scale = baseW / 1000;
      const y_offset = (baseW - baseH) / 2;
      targetPasteX = x_min_norm * scale;
      targetPasteY = y_min_norm * scale - y_offset;
      targetPasteWidth = (x_max_norm - x_min_norm) * scale;
      targetPasteHeight = (y_max_norm - y_min_norm) * scale;
    } else {
      const scale = baseH / 1000;
      const x_offset = (baseH - baseW) / 2;
      targetPasteX = x_min_norm * scale - x_offset;
      targetPasteY = y_min_norm * scale;
      targetPasteWidth = (x_max_norm - x_min_norm) * scale;
      targetPasteHeight = (y_max_norm - y_min_norm) * scale;
    }

    // Resize the overlay to fit within the target dimensions while preserving aspect ratio
    overlayImage.contain(targetPasteWidth, targetPasteHeight);

    // Calculate the offset to center the (potentially letterboxed) overlay within the target area
    const offsetX = (targetPasteWidth - overlayImage.width) / 2;
    const offsetY = (targetPasteHeight - overlayImage.height) / 2;

    // Composite the correctly sized and positioned overlay
    baseImage.composite(overlayImage, Math.floor(targetPasteX + offsetX), Math.floor(targetPasteY + offsetY));

    const finalImageBuffer = await baseImage.encode(0); // PNG

    const finalFilename = `final_vto_${Date.now()}.png`;
    const finalStoragePath = `${user_id}/${finalFilename}`;
    
    const { error: uploadError } = await supabase.storage
      .from(UPLOAD_BUCKET)
      .upload(finalStoragePath, finalImageBuffer, { contentType: 'image/png', upsert: true });

    if (uploadError) throw new Error(`Failed to upload final composite image: ${uploadError.message}`);

    const { data: { publicUrl } } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(finalStoragePath);

    return new Response(JSON.stringify({ success: true, final_composite_url: publicUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[CompositeTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});