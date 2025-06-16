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

    if (imageUrl.includes('supabase.co')) {
        // It's a Supabase URL, use the robust download method via the client
        const url = new URL(imageUrl);
        const pathParts = url.pathname.split(`/public/${UPLOAD_BUCKET}/`);
        if (pathParts.length < 2) {
            throw new Error(`Could not parse Supabase storage path from URL: ${imageUrl}`);
        }
        const storagePath = decodeURIComponent(pathParts[1]);
        
        const { data: blob, error: downloadError } = await supabase.storage
            .from(UPLOAD_BUCKET)
            .download(storagePath);

        if (downloadError) {
            throw new Error(`Supabase download failed for path ${storagePath}: ${downloadError.message}`);
        }
        imageBuffer = await blob.arrayBuffer();
    } else {
        // It's an external URL, use a standard fetch
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

    const [y_min, x_min, y_max, x_max] = box;
    const pasteX = Math.floor((x_min / 1000) * baseImage.width);
    const pasteY = Math.floor((y_min / 1000) * baseImage.height);
    const pasteWidth = Math.floor(((x_max - x_min) / 1000) * baseImage.width);
    const pasteHeight = Math.floor(((y_max - y_min) / 1000) * baseImage.height);

    overlayImage.resize(pasteWidth, pasteHeight);
    baseImage.composite(overlayImage, pasteX, pasteY);

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