import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-lite-preview-06-17";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const systemPrompt = `You are an expert AI Fashion Stylist. You will be given an image of a model wearing an incomplete outfit and a selection of candidate garments. Your task is to choose the single best garment from the candidates that stylistically completes the outfit.

### Your Inputs:
- **MAIN IMAGE:** The image of the model.
- **MISSING ITEM TYPE:** The category of clothing that is missing (e.g., 'lower_body', 'shoes').
- **CANDIDATE IMAGES:** A numbered list of available garments that fit the missing category.

### Your Logic:
1.  **Analyze the Main Image:** Assess the style, color palette, and overall aesthetic of the garment(s) the model is already wearing.
2.  **Evaluate Candidates:** For each candidate image, determine if it stylistically complements the main image.
3.  **Make a Decision:** Choose the single best option. If multiple options are good, choose the one that creates the most cohesive and fashionable look.

### Your Output:
Your entire response MUST be a single, valid JSON object with two keys: "best_garment_index" (the number of the best candidate image) and "reasoning" (a brief explanation for your choice).

**Example Output 1 (Incomplete):**
\`\`\`json
{
  "best_garment_index": 2,
  "reasoning": "Candidate 2, the dark wash denim jeans, provides a classic and complementary contrast to the white t-shirt in the main image, creating a timeless casual look."
}
\`\`\`

**Example Output 2 (Incomplete):**
\`\`\`json
{
  "best_garment_index": 0,
  "reasoning": "The black leather boots in Candidate 0 are the most versatile and stylistically appropriate choice for the punk-rock aesthetic of the jacket."
}
\`\`\`

**Example Output 3 (Complete):**
\`\`\`json
{
  "best_garment_index": 1,
  "reasoning": "The model is wearing the generated pants, a plausible t-shirt, and sneakers, forming a complete casual outfit."
}
\`\`\`
`;

async function downloadImageAsPart(supabase: SupabaseClient, url: string, label: string): Promise<Part[]> {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download ${label}: ${error.message}`);
    const buffer = await data.arrayBuffer();
    const base64 = encodeBase64(buffer);
    return [{ text: `--- ${label} ---` }, { inlineData: { mimeType: data.type, data: base64 } }];
}

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  const { pair_job_id } = await req.json();
  if (!pair_job_id) {
    throw new Error("pair_job_id is required.");
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[StylistChooser][Job ${pair_job_id.substring(0, 8)}]`;

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('user_id, metadata')
      .eq('id', pair_job_id)
      .single();

    if (fetchError) throw new Error(`Failed to fetch job ${pair_job_id}: ${fetchError.message}`);
    
    const { user_id, metadata } = job;
    const { 
        qa_best_image_base64: vto_image_base64,
        outfit_completeness_analysis,
        auto_complete_pack_id 
    } = metadata || {};

    const missing_item_type = outfit_completeness_analysis?.missing_items?.[0];

    if (!vto_image_base64 || !missing_item_type || !auto_complete_pack_id || !user_id) {
      const missingFields = [];
      if (!vto_image_base64) missingFields.push('qa_best_image_base64');
      if (!missing_item_type) missingFields.push('outfit_completeness_analysis.missing_items');
      if (!auto_complete_pack_id) missingFields.push('auto_complete_pack_id');
      if (!user_id) missingFields.push('user_id');
      
      throw new Error(`Job metadata is missing required fields: ${missingFields.join(', ')}.`);
    }
    
    console.log(`${logPrefix} Invoked. Missing item: '${missing_item_type}'.`);
    
    const { data: packItems, error: packItemsError } = await supabase
      .from('mira-agent-garment-pack-items')
      .select('garment_id')
      .eq('pack_id', auto_complete_pack_id);
    if (packItemsError) throw packItemsError;
    if (!packItems || packItems.length === 0) throw new Error("The selected garment pack is empty.");

    const garmentIds = packItems.map(item => item.garment_id);
    const { data: allGarments, error: garmentsError } = await supabase
      .from('mira-agent-garments')
      .select('id, storage_path, attributes, name, image_hash')
      .in('id', garmentIds);
    if (garmentsError) throw garmentsError;

    const candidateGarments = allGarments.filter(g => {
        const fitType = g.attributes?.type_of_fit;
        if (!fitType) return false;
        return fitType.replace(/\s+/g, '_') === missing_item_type;
    });

    if (candidateGarments.length === 0) {
      throw new Error(`Auto-complete failed: The selected garment pack does not contain any items of the required type ('${missing_item_type.replace(/_/g, ' ')}').`);
    }
    console.log(`${logPrefix} Found ${candidateGarments.length} candidate garments of type '${missing_item_type}'.`);

    let chosenGarment;

    if (candidateGarments.length === 1) {
        console.log(`${logPrefix} Only one candidate found. Selecting it automatically.`);
        chosenGarment = candidateGarments[0];
    } else {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
        const parts: Part[] = [
            { text: `--- MAIN IMAGE ---` },
            { inlineData: { mimeType: 'image/png', data: vto_image_base64 } },
            { text: `--- MISSING ITEM TYPE --- \n${missing_item_type}` }
        ];

        console.log(`${logPrefix} Downloading candidate images for analysis...`);
        const candidateImagePromises = candidateGarments.map((garment, index) => 
            downloadImageAsPart(supabase, garment.storage_path, `CANDIDATE IMAGE ${index}`)
        );
        const candidateImagePartsArrays = await Promise.all(candidateImagePromises);
        parts.push(...candidateImagePartsArrays.flat());

        console.log(`${logPrefix} Calling Gemini for stylistic choice...`);
        const result = await ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts }],
            generationConfig: { responseMimeType: "application/json" },
            safetySettings,
            config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
        });

        const choice = extractJson(result.text);
        const chosenIndex = choice.best_garment_index;
        console.log(`${logPrefix} AI Reasoning: "${choice.reasoning}"`);

        if (typeof chosenIndex !== 'number' || chosenIndex < 0 || chosenIndex >= candidateGarments.length) {
            console.warn(`${logPrefix} AI returned an invalid index (${chosenIndex}). Selecting the first candidate as a fallback.`);
            chosenGarment = candidateGarments[0];
        } else {
            console.log(`${logPrefix} AI selected candidate index: ${chosenIndex}.`);
            chosenGarment = candidateGarments[chosenIndex];
        }
    }

    // Update the job with the chosen garment AND advance the state.
    console.log(`${logPrefix} Updating job with chosen garment and advancing status to 'awaiting_auto_complete'.`);
    const { error: updateError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .update({
        status: 'awaiting_auto_complete', // Advance the state
        metadata: {
          ...metadata,
          chosen_completion_garment: chosenGarment,
          google_vto_step: 'awaiting_auto_complete' // Also update the step tracker
        }
      })
      .eq('id', pair_job_id);

    if (updateError) {
      throw new Error(`Failed to update job ${pair_job_id}: ${updateError.message}`);
    }

    // Re-invoke the worker to proceed to the next step.
    console.log(`${logPrefix} Invoking the VTO worker to continue the process from the new state.`);
    supabase.functions.invoke('MIRA-AGENT-worker-vto-pack-item', {
        body: { pair_job_id: pair_job_id }
    }).catch(console.error);

    return new Response(JSON.stringify({ success: true, message: "Stylist choice has been saved and the next step has been triggered." }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[StylistChooser][Job ${pair_job_id || 'unknown'}] Error:`, error);
    if (pair_job_id) {
        await supabase.from('mira-agent-bitstudio-jobs').update({
            status: 'failed',
            error_message: `Stylist Chooser failed: ${error.message}`
        }).eq('id', pair_job_id);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});