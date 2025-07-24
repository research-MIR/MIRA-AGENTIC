import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-1.5-flash-latest";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a "Triage AI". Your sole purpose is to analyze a user's request for image editing and generate a concise, high-level "mission brief" for a specialist AI.

### Your Inputs:
- A user's text prompt.
- A SOURCE image.
- An optional POSE reference image.
- An optional array of GARMENT reference images.

### Your Task:
Based on the provided inputs, create a single, clear instruction sentence in English that summarizes the user's goal.

### Rules:
- Be concise.
- If a pose reference is present, include "change the pose".
- If garment references are present, include "change the garment".
- If both are present, combine them with "AND".
- If the text prompt contains a specific instruction (e.g., "make him a viking"), use that as the primary instruction.

### Examples:
- **Input:** Text="make him a viking", Source Image
- **Output:** "Change the man's clothes to a viking warrior's outfit."

- **Input:** Text="use this pose", Source Image, Pose Image
- **Output:** "Change the pose to match the reference image."

- **Input:** Text="put him in this jacket", Source Image, Garment Image
- **Output:** "Change the garment to match the reference image."

- **Input:** Text="use this pose and jacket", Source Image, Pose Image, Garment Image
- **Output:** "Change the pose AND the garment to match the respective reference images."

Your entire response MUST be a single, valid JSON object with ONE key, "mission_brief".`;

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

async function downloadImageAsPart(supabase: SupabaseClient, publicUrl: string, label: string): Promise<Part[]> {
    const url = new URL(publicUrl);
    const pathSegments = url.pathname.split('/');
    const bucketName = pathSegments[pathSegments.indexOf('public') + 1];
    const filePath = decodeURIComponent(pathSegments.slice(pathSegments.indexOf(bucketName) + 1).join('/'));
    const { data, error } = await supabase.storage.from(bucketName).download(filePath);
    if (error) throw new Error(`Failed to download ${label}: ${error.message}`);
    const buffer = await data.arrayBuffer();
    const base64 = encodeBase64(buffer);
    return [
        { text: `--- ${label} ---` },
        { inlineData: { mimeType: data.type, data: base64 } }
    ];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { user_prompt, source_image_url, pose_image_url, garment_image_urls } = await req.json();
    if (!user_prompt || !source_image_url) {
      throw new Error("user_prompt and source_image_url are required.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    
    const parts: Part[] = [{ text: `**User Prompt:**\n${user_prompt}` }];

    const imagePromises: Promise<Part[]>[] = [
        downloadImageAsPart(supabase, source_image_url, "SOURCE IMAGE")
    ];

    if (pose_image_url) {
        imagePromises.push(downloadImageAsPart(supabase, pose_image_url, "POSE REFERENCE IMAGE"));
    }
    if (garment_image_urls && Array.isArray(garment_image_urls)) {
        garment_image_urls.forEach((url, index) => {
            imagePromises.push(downloadImageAsPart(supabase, url, `GARMENT REFERENCE ${index + 1}`));
        });
    }

    const imagePartsArrays = await Promise.all(imagePromises);
    parts.push(...imagePartsArrays.flat());

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });

    const responseJson = extractJson(result.text);
    if (!responseJson.mission_brief) {
        throw new Error("Triage AI did not return a mission_brief in the expected format.");
    }

    return new Response(JSON.stringify({ mission_brief: responseJson.mission_brief }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[MissionBriefTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});