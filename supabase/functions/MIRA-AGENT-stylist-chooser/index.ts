import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
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

**Example Output:**
\`\`\`json
{
  "best_garment_index": 2,
  "reasoning": "Candidate 2, the dark wash denim jeans, provides a classic and complementary contrast to the white t-shirt in the main image, creating a timeless casual look."
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

  try {
    const { vto_image_base64, missing_item_type, pack_id, user_id } = await req.json();
    if (!vto_image_base64 || !missing_item_type || !pack_id || !user_id) {
      throw new Error("vto_image_base64, missing_item_type, pack_id, and user_id are required.");
    }
    
    const logPrefix = `[StylistChooser][Pack ${pack_id.substring(0, 8)}]`;
    console.log(`${logPrefix} Invoked. Missing item: '${missing_item_type}'.`);

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const { data: packItems, error: packItemsError } = await supabase
      .from('mira-agent-garment-pack-items')
      .select('garment_id')
      .eq('pack_id', pack_id);
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
        // Handle both 'upper body' and 'upper_body' by normalizing them
        return fitType.replace(/\s+/g, '_') === missing_item_type;
    });

    if (candidateGarments.length === 0) {
      throw new Error(`The selected pack does not contain any garments of type '${missing_item_type}'.`);
    }
    console.log(`${logPrefix} Found ${candidateGarments.length} candidate garments of type '${missing_item_type}'.`);

    if (candidateGarments.length === 1) {
        console.log(`${logPrefix} Only one candidate found. Selecting it automatically.`);
        return new Response(JSON.stringify(candidateGarments[0]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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
        return new Response(JSON.stringify(candidateGarments[0]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`${logPrefix} AI selected candidate index: ${chosenIndex}.`);
    return new Response(JSON.stringify(candidateGarments[chosenIndex]), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[StylistChooser] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});