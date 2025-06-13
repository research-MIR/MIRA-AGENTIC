import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are an expert at parsing conversation history to find specific images. You will be given a JSON object representing a conversation history and a user's query. The history contains turns from a 'user' and a 'function'. The 'function' turns for 'generate_image' contain a 'response' with an array of 'images', each with a 'publicUrl' and a 'description'.

Your ONLY task is to find the single image that best matches the user's query.

**Instructions:**
1.  Analyze the user's query.
2.  Scan the 'description' of each image in the history.
3.  If you find a clear match, return a JSON object with the URL of that single image: \`{"imageUrl": "..."}\`.
4.  If the query is ambiguous or no single image is a clear match, return \`{"imageUrl": null}\`.
5.  Do NOT return anything other than the JSON object.`;

interface Image {
  publicUrl: string;
  description: string;
  jobId?: string;
}

function extractImagesFromHistory(history: Content[], jobId: string): Image[] {
  return history
    .filter(turn => turn.role === 'function' && (turn.parts[0]?.functionResponse?.name === 'generate_image' || turn.parts[0]?.functionResponse?.name === 'fal_image_to_image'))
    .flatMap(turn => turn.parts[0]?.functionResponse?.response?.images || [])
    .map((img: any) => ({ ...img, jobId }));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { history, user_query_for_image, job_id } = await req.json();
    if (!history || !job_id) {
      throw new Error("Missing required parameters: history or job_id.");
    }

    const allImages = extractImagesFromHistory(history, job_id);
    if (allImages.length === 0) {
      return new Response(JSON.stringify({ text: "I couldn't find any images in our conversation to refine. Please generate an image first." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (user_query_for_image) {
      console.log(`[RefinementTool] User provided a specific query: "${user_query_for_image}". Attempting to find a match.`);
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      
      const contextForMatcher = {
          conversation_history: history,
          user_query: user_query_for_image
      };

      const result = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(contextForMatcher) }] }],
          generationConfig: { responseMimeType: "application/json" },
          config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
      });

      const matchResult = JSON.parse(result.text);
      
      if (matchResult && matchResult.imageUrl) {
        console.log(`[RefinementTool] Found a specific image match: ${matchResult.imageUrl}. Proceeding directly to upscale.`);
        
        const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
        const { data: upscaleResult, error: upscaleError } = await supabase.functions.invoke('MIRA-AGENT-tool-upscale-image-clarity', {
            body: { image_url: matchResult.imageUrl, job_id: job_id, upscale_factor: 1.5 }
        });

        if (upscaleError) throw upscaleError;
        
        return new Response(JSON.stringify({
            isImageGeneration: true,
            message: `I've refined the image you requested.`,
            images: [{ publicUrl: upscaleResult.upscaled_image.url, storagePath: '' }]
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    console.log(`[RefinementTool] No specific match found or query was ambiguous. Proposing all ${allImages.length} images as options.`);
    const finalResult = {
      isRefinementProposal: true,
      summary: "Of course! Which of these images would you like to refine?",
      options: allImages.map(img => ({ url: img.publicUrl, jobId: img.jobId })),
    };
    return new Response(JSON.stringify(finalResult), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error("[RefinementTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});