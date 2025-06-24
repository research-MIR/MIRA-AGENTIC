// v1.1.0
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";

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

async function cleanMask(base64Data: string): Promise<string> {
    const maskImg = await loadImage(`data:image/png;base64,${base64Data}`);
    const { width, height } = maskImg;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(maskImg, 0, 0);

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const visited = new Uint8Array(width * height).fill(0);
    const components = [];

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;
            if (data[index * 4] > 128 && !visited[index]) {
                const component = [];
                const queue = [{x, y}];
                visited[index] = 1;
                while (queue.length > 0) {
                    const {x: cx, y: cy} = queue.shift()!;
                    component.push({x: cx, y: cy});
                    const neighbors = [[0, 1], [0, -1], [1, 0], [-1, 0]];
                    for (const [dx, dy] of neighbors) {
                        const nx = cx + dx;
                        const ny = cy + dy;
                        const nIndex = ny * width + nx;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height && !visited[nIndex] && data[nIndex * 4] > 128) {
                            visited[nIndex] = 1;
                            queue.push({x: nx, y: ny});
                        }
                    }
                }
                components.push(component);
            }
        }
    }

    if (components.length <= 1) return base64Data;

    components.sort((a, b) => b.length - a.length);
    const largestComponent = components[0];

    const cleanCanvas = createCanvas(width, height);
    const cleanCtx = cleanCanvas.getContext('2d');
    const cleanImageData = cleanCtx.createImageData(width, height);
    
    for (const {x, y} of largestComponent) {
        const index = (y * width + x) * 4;
        cleanImageData.data[index] = 255;
        cleanImageData.data[index + 1] = 255;
        cleanImageData.data[index + 2] = 255;
        cleanImageData.data[index + 3] = 255;
    }
    cleanCtx.putImageData(cleanImageData, 0, 0);
    
    return cleanCanvas.toDataURL().split(',')[1];
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

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: { responseMimeType: "application/json" },
        safetySettings,
    });

    const responseJson = extractJson(result.text);
    const maskData = responseJson.masks || responseJson;
    if (!Array.isArray(maskData)) {
      throw new Error("API did not return a valid array of masks.");
    }

    console.log(`[SegmentImageTool] Received ${maskData.length} raw masks. Starting cleaning process...`);
    const cleanedMasks = await Promise.all(
        maskData.map(async (maskItem) => {
            if (!maskItem.mask) return maskItem;
            const cleanedMaskData = await cleanMask(maskItem.mask);
            return { ...maskItem, mask: cleanedMaskData };
        })
    );
    console.log(`[SegmentImageTool] Cleaning complete. Returning ${cleanedMasks.length} cleaned masks.`);

    return new Response(JSON.stringify({ masks: cleanedMasks }), {
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