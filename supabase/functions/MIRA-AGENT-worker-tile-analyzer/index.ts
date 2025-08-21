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

const systemPrompt = `You are a hyper-detailed, objective image analyst. Your task is to create a descriptive caption for an image tile that will be used as a prompt for an AI upscaling and refinement model.

### Core Directives:
1.  **Objective Detail Only:** Your description MUST focus exclusively on concrete, physical details. Describe textures, materials, shapes, and specific features.
2.  **AVOID Subjectivity:** Do NOT describe general style, mood, or lighting (e.g., avoid terms like 'cinematic lighting', 'somber mood', 'vintage style').
3.  **Focus on Key Features:** Pay extremely close attention to:
    *   **Facial Anatomy:** Describe the precise shape of the face, jawline, nose, and lips. Note the state of the eyes (e.g., 'eyes are fully open', 'eyes are half-closed'). Describe the expression factually (e.g., 'a slight smile', 'a neutral expression').
    *   **Hair:** Describe the texture and type (e.g., 'tightly coiled black hair', 'straight, fine blonde hair').
    *   **Hands, Feet, and Appendages:** Describe these in detail. Note the shape and form of fingers and hands.

### The Corrective Captioning Mandate (CRITICAL):
Your most important rule is to describe anatomical features **as if they are perfectly formed**, even if they are distorted or misshapen in the source image. The goal is to generate a prompt that helps the *next* AI model *correct* the flaws.
-   If a hand has six fingers, describe it as "a perfectly formed hand with five fingers."
-   If a face is slightly distorted, describe its features as if they were symmetrical and well-proportioned.
-   If an eye is misshapen, describe it as "a clear, well-defined eye."

### Output Format:
Your output must be a single, descriptive paragraph in natural language, written in English.`;

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
      .not('source_tile_bucket', 'is', null)
      .not('source_tile_path', 'is', null)
      .select('source_tile_bucket, source_tile_path')
      .single();

    if (claimError) throw new Error(`Claiming tile failed: ${claimError.message}`);
    if (!claimedTile) {
      console.log(`${logPrefix} Tile already claimed, not in 'pending_analysis' state, or missing storage info. Exiting.`);
      return new Response(JSON.stringify({ success: true, message: "Tile not eligible for analysis." }), { headers: corsHeaders });
    }

    const { source_tile_bucket, source_tile_path } = claimedTile;

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