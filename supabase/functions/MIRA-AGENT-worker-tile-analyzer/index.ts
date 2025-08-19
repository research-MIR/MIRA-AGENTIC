import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = "You are an expert image analyst. Your sole task is to describe the provided image tile with extreme detail. Focus on textures, materials, lighting, and the specific objects or parts of objects visible. Your output should be a single, descriptive paragraph in natural language, suitable for a text-to-image model. The language must be in English.";

async function downloadImage(supabase: SupabaseClient, publicUrl: string) {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download from Supabase storage (${filePath}): ${error.message}`);
    return data;
}

serve(async (req) => {
  console.log("[TileAnalyzerWorker] Function invocation started."); // Canary Log

  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { tile_id, tile_base64, mime_type, tile_url } = await req.json();
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TileAnalyzerWorker][${tile_id || tile_url || 'direct_call'}]`;

  try {
    let imageBase64 = tile_base64;
    let imageMimeType = mime_type;

    if (tile_url) {
        const imageBlob = await downloadImage(supabase, tile_url);
        imageBase64 = encodeBase64(await imageBlob.arrayBuffer());
        imageMimeType = imageBlob.type;
    } else if (tile_id) {
        const { data: tile, error: fetchError } = await supabase
          .from('mira_agent_tiled_upscale_tiles')
          .select('source_tile_url')
          .eq('id', tile_id)
          .single();
        if (fetchError) throw fetchError;
        if (!tile.source_tile_url) throw new Error("Tile record is missing a source_tile_url.");

        const imageBlob = await downloadImage(supabase, tile.source_tile_url);
        imageBase64 = encodeBase64(await imageBlob.arrayBuffer());
        imageMimeType = imageBlob.type;
    }

    if (!imageBase64) {
        throw new Error("No image data provided (via tile_id, tile_url, or directly as base64).");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{
            role: 'user',
            parts: [{
                inlineData: {
                    mimeType: imageMimeType || 'image/png',
                    data: imageBase64
                }
            }]
        }],
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const description = result.text.trim();
    if (!description) throw new Error("AI model failed to generate a description.");

    if (tile_id) {
        await supabase
          .from('mira_agent_tiled_upscale_tiles')
          .update({ generated_prompt: description, status: 'pending_generation' })
          .eq('id', tile_id);
    }

    // FIX: Return a proper JSON response
    return Response.json({ success: true, prompt: description }, { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    if (tile_id) {
        await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'failed', error_message: `Analysis failed: ${error.message}` }).eq('id', tile_id);
    }
    // FIX: Return error as proper JSON
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});