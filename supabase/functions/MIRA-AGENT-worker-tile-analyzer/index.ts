import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
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

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { tile_id } = await req.json();
  if (!tile_id) {
    return new Response(JSON.stringify({ error: "tile_id is required." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[TileAnalyzerWorker][${tile_id}]`;

  try {
    const { data: claimedTile, error: claimError } = await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ status: 'analyzing' })
      .eq('id', tile_id)
      .eq('status', 'pending_analysis')
      .select('source_tile_bucket, source_tile_path')
      .single();

    if (claimError) throw new Error(`Claiming tile failed: ${claimError.message}`);
    if (!claimedTile) {
      console.log(`${logPrefix} Tile already claimed or not in 'pending_analysis' state. Exiting.`);
      return new Response(JSON.stringify({ success: true, message: "Tile already processed." }), { headers: corsHeaders });
    }

    const { source_tile_bucket, source_tile_path } = claimedTile;
    if (!source_tile_bucket || !source_tile_path) {
      throw new Error("Tile record is missing storage bucket or path information.");
    }

    const { data: imageBlob, error: downloadError } = await supabase.storage.from(source_tile_bucket).download(source_tile_path);
    if (downloadError) throw downloadError;

    const imageBase64 = encodeBase64(await imageBlob.arrayBuffer());
    const imageMimeType = imageBlob.type;

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{
            role: 'user',
            parts: [{
                inlineData: {
                    mimeType: imageMimeType || 'image/webp',
                    data: imageBase64
                }
            }]
        }],
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const description = result.text.trim();
    if (!description) throw new Error("AI model failed to generate a description.");

    await supabase
      .from('mira_agent_tiled_upscale_tiles')
      .update({ generated_prompt: description, status: 'pending_generation' })
      .eq('id', tile_id);

    return Response.json({ success: true, prompt: description }, { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira_agent_tiled_upscale_tiles').update({ status: 'analysis_failed', error_message: `Analysis failed: ${error.message}` }).eq('id', tile_id);
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders });
  }
});