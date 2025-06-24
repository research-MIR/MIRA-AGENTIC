// v1.2.0
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const INFERENCE_COUNT = 3; // Run inference 3 times for consensus

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

function extractJson(text: string): any {
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) return JSON.parse(match[1]);
    try { return JSON.parse(text); } catch (e) {
        console.error("[SegmentImageTool] Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

async function getConsensusMask(base64Masks: string[]): Promise<string> {
    if (base64Masks.length === 0) throw new Error("No masks provided for consensus.");
    if (base64Masks.length === 1) return base64Masks[0];

    const firstMaskImage = await loadImage(`data:image/png;base64,${base64Masks[0]}`);
    const { width, height } = firstMaskImage;

    const voteMap = new Uint8Array(width * height).fill(0);

    for (const base64 of base64Masks) {
        const maskImg = await loadImage(`data:image/png;base64,${base64}`);
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(maskImg, 0, 0);
        const imageData = ctx.getImageData(0, 0, width, height).data;
        for (let i = 0; i < imageData.length; i += 4) {
            if (imageData[i] > 128) { // If pixel is white
                voteMap[i / 4]++;
            }
        }
    }

    const consensusCanvas = createCanvas(width, height);
    const consensusCtx = consensusCanvas.getContext('2d');
    const consensusImageData = consensusCtx.createImageData(width, height);
    const consensusData = consensusImageData.data;
    const threshold = Math.ceil(base64Masks.length / 2);

    for (let i = 0; i < voteMap.length; i++) {
        if (voteMap[i] >= threshold) {
            consensusData[i * 4] = 255;
            consensusData[i * 4 + 1] = 255;
            consensusData[i * 4 + 2] = 255;
            consensusData[i * 4 + 3] = 255;
        }
    }
    consensusCtx.putImageData(consensusImageData, 0, 0);

    return consensusCanvas.toDataURL().split(',')[1];
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type } = await req.json();
    if (!image_base64 || !mime_type || !prompt) {
      throw new Error("image_base64, mime_type, and prompt are required.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const userParts: Part[] = [
        { text: "SOURCE IMAGE:" },
        { inlineData: { mimeType: mime_type, data: image_base64 } },
    ];
    if (reference_image_base64 && reference_mime_type) {
        userParts.push(
            { text: "REFERENCE IMAGE:" },
            { inlineData: { mimeType: reference_mime_type, data: reference_image_base64 } }
        );
    }
    userParts.push({ text: prompt });

    const inferencePromises = Array(INFERENCE_COUNT).fill(0).map(() => 
        ai.models.generateContent({
            model: MODEL_NAME,
            contents: [{ role: 'user', parts: userParts }],
            generationConfig: { responseMimeType: "application/json" },
            safetySettings,
        })
    );

    const results = await Promise.allSettled(inferencePromises);
    
    const successfulResponses = results
        .filter(r => r.status === 'fulfilled' && r.value.text)
        .map(r => extractJson((r as PromiseFulfilledResult<any>).value.text));

    if (successfulResponses.length === 0) {
        throw new Error("All segmentation inferences failed or returned empty responses.");
    }

    const allMasks = successfulResponses.flatMap(res => (res.masks || [res])).filter(m => m.mask);
    if (allMasks.length === 0) {
        throw new Error("No valid masks were found in any of the successful responses.");
    }

    console.log(`[SegmentImageTool] Received ${allMasks.length} raw masks from ${successfulResponses.length} successful inferences. Starting consensus process...`);
    
    const consensusMaskData = await getConsensusMask(allMasks.map(m => m.mask));
    
    const finalResult = {
        ...allMasks[0], // Use the box and label from the first successful result
        mask: consensusMaskData,
    };

    console.log(`[SegmentImageTool] Consensus complete. Returning final mask.`);

    return new Response(JSON.stringify({ masks: [finalResult] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[SegmentImageTool] Unhandled Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});