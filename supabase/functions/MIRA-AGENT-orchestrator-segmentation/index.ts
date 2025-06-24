import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, Part, HarmCategory, HarmBlockThreshold } from 'https://esm.sh/@google/genai@0.15.0';
import { createCanvas, loadImage, Canvas } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-flash-preview-05-20";
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const NUM_WORKERS = 5; // Number of parallel API calls

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
        console.error("[Orchestrator] Failed to parse JSON from model response:", text);
        throw new Error("The model returned a response that could not be parsed as JSON.");
    }
}

async function uploadBufferToStorage(supabase: SupabaseClient, buffer: Uint8Array, userId: string, filename: string): Promise<string> {
    const filePath = `${userId}/segmentation-final/${Date.now()}-${filename}`;
    const { error } = await supabase.storage
      .from(GENERATED_IMAGES_BUCKET)
      .upload(filePath, buffer, { contentType: 'image/png', upsert: true });
    if (error) throw new Error(`Storage upload failed for ${filename}: ${error.message}`);
    const { data: { publicUrl } } = supabase.storage.from(GENERATED_IMAGES_BUCKET).getPublicUrl(filePath);
    return publicUrl;
}

function expandMask(canvas: Canvas, expansionPercent: number) {
    if (expansionPercent <= 0) return;

    const ctx = canvas.getContext('2d');
    const expansionAmount = Math.round(Math.min(canvas.width, canvas.height) * expansionPercent);
    if (expansionAmount <= 0) return;

    const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const originalData = new Uint8ClampedArray(originalImageData.data);
    const newData = originalImageData.data;

    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            if (newData[i] > 128) continue;

            let foundNeighbor = false;
            for (let dy = -expansionAmount; dy <= expansionAmount; dy++) {
                for (let dx = -expansionAmount; dx <= expansionAmount; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx >= 0 && nx < canvas.width && ny >= 0 && ny < canvas.height) {
                        const ni = (ny * canvas.width + nx) * 4;
                        if (originalData[ni] > 128) {
                            newData[i] = 255; newData[i + 1] = 255; newData[i + 2] = 255; newData[i + 3] = 255;
                            foundNeighbor = true;
                            break;
                        }
                    }
                }
                if (foundNeighbor) break;
            }
        }
    }
    ctx.putImageData(originalImageData, 0, 0);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const PRE_VOTE_EXPANSION_PERCENT = 0.02;
  const POST_VOTE_EXPANSION_PERCENT = 0.02;

  const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type, user_id, image_dimensions } = await req.json();
  const requestId = `segment-orchestrator-${Date.now()}`;
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  let aggregationJobId: string | null = null;

  try {
    if (!user_id || !image_base64 || !mime_type || !prompt || !image_dimensions) {
      throw new Error("Missing required parameters for new job.");
    }

    const { data: newJob, error: insertError } = await supabase
      .from('mira-agent-mask-aggregation-jobs')
      .insert({ user_id, status: 'aggregating', source_image_dimensions: image_dimensions, results: [] })
      .select('id')
      .single();
    if (insertError) throw insertError;
    aggregationJobId = newJob.id;
    console.log(`[Orchestrator][${requestId}] Aggregation job ${aggregationJobId} created.`);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const userParts: Part[] = [
        { text: "SOURCE IMAGE:" }, { inlineData: { mimeType: mime_type, data: image_base64 } },
    ];
    if (reference_image_base64 && reference_mime_type) {
        userParts.push({ text: "REFERENCE IMAGE:" }, { inlineData: { mimeType: reference_mime_type, data: reference_image_base64 } });
    }
    userParts.push({ text: prompt });
    const contents: Content[] = [{ role: 'user', parts: userParts }];

    const workerPromises = Array.from({ length: NUM_WORKERS }).map((_, i) => 
        ai.models.generateContent({
            model: MODEL_NAME,
            contents: contents,
            generationConfig: { responseMimeType: "application/json" },
            safetySettings,
        }).then(result => {
            if (!result.text) throw new Error("Model returned an empty response.");
            return extractJson(result.text);
        }).catch(err => ({ error: err.message }))
    );

    const settledResults = await Promise.allSettled(workerPromises);
    const allResults = settledResults.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message });
    
    await supabase.from('mira-agent-mask-aggregation-jobs').update({ results: allResults }).eq('id', aggregationJobId);
    console.log(`[Orchestrator][${requestId}] All workers finished. Results saved to DB.`);

    const validRuns = allResults.filter(run => run && !run.error && Array.isArray(run) && run.length > 0);
    if (validRuns.length === 0) throw new Error("No valid mask data found in any of the segmentation runs.");
    
    const firstMasksFromEachRun = validRuns.map(run => run[0]).filter(mask => mask && mask.box_2d && mask.mask);
    if (firstMasksFromEachRun.length === 0) throw new Error("Could not extract any valid masks from the successful runs.");

    const maskImages = await Promise.all(firstMasksFromEachRun.map(run => {
        let base64Data = run.mask;
        if (run.mask.includes(',')) {
            base64Data = run.mask.split(',')[1];
        }
        const imageBuffer = decodeBase64(base64Data);
        return loadImage(imageBuffer);
    }));
    
    const fullMaskCanvases = firstMasksFromEachRun.map((run, index) => {
        const maskImg = maskImages[index];
        const [y0, x0, y1, x1] = run.box_2d;
        const absX0 = Math.floor((x0 / 1000) * image_dimensions.width);
        const absY0 = Math.floor((y0 / 1000) * image_dimensions.height);
        const bboxWidth = Math.ceil(((x1 - x0) / 1000) * image_dimensions.width);
        const bboxHeight = Math.ceil(((y1 - y0) / 1000) * image_dimensions.height);
        const fullCanvas = createCanvas(image_dimensions.width, image_dimensions.height);
        fullCanvas.getContext('2d').drawImage(maskImg, absX0, absY0, bboxWidth, bboxHeight);
        return fullCanvas;
    });

    console.log(`[Orchestrator][${requestId}] Applying pre-vote expansion of ${PRE_VOTE_EXPANSION_PERCENT * 100}% to each individual mask.`);
    fullMaskCanvases.forEach(canvas => expandMask(canvas, PRE_VOTE_EXPANSION_PERCENT));
    console.log(`[Orchestrator][${requestId}] Pre-vote expansion complete.`);

    const combinedCanvas = createCanvas(image_dimensions.width, image_dimensions.height);
    const combinedCtx = combinedCanvas.getContext('2d');
    const maskImageDatas = fullMaskCanvases.map(c => c.getContext('2d').getImageData(0, 0, image_dimensions.width, image_dimensions.height).data);
    const combinedImageData = combinedCtx.createImageData(image_dimensions.width, image_dimensions.height);
    const combinedData = combinedImageData.data;

    const majorityThreshold = Math.floor(maskImageDatas.length / 2) + 1;
    for (let i = 0; i < combinedData.length; i += 4) {
        let voteCount = 0;
        for (const data of maskImageDatas) { if (data[i] > 128) voteCount++; }
        if (voteCount >= majorityThreshold) {
            combinedData[i] = 255; combinedData[i+1] = 255; combinedData[i+2] = 255; combinedData[i+3] = 255;
        }
    }
    combinedCtx.putImageData(combinedImageData, 0, 0);
    console.log(`[Orchestrator][${requestId}] Majority voting complete.`);

    console.log(`[Orchestrator][${requestId}] Applying post-vote expansion of ${POST_VOTE_EXPANSION_PERCENT * 100}% to the combined mask.`);
    expandMask(combinedCanvas, POST_VOTE_EXPANSION_PERCENT);
    console.log(`[Orchestrator][${requestId}] Post-vote expansion complete.`);

    const finalImageData = combinedCtx.getImageData(0, 0, image_dimensions.width, image_dimensions.height);
    const finalData = finalImageData.data;
    for (let i = 0; i < finalData.length; i += 4) {
        if (finalData[i] > 128) { finalData[i] = 255; finalData[i + 1] = 0; finalData[i + 2] = 0; finalData[i + 3] = 150; } 
        else { finalData[i + 3] = 0; }
    }
    combinedCtx.putImageData(finalImageData, 0, 0);

    const finalImageBuffer = combinedCanvas.toBuffer('image/png');
    if (!finalImageBuffer) {
        throw new Error("Failed to convert final canvas to buffer. The canvas might be empty or invalid.");
    }
    const finalPublicUrl = await uploadBufferToStorage(supabase, finalImageBuffer, user_id, 'final_mask.png');

    await supabase.from('mira-agent-mask-aggregation-jobs')
      .update({ status: 'complete', final_mask_base64: finalPublicUrl })
      .eq('id', aggregationJobId);

    return new Response(JSON.stringify({ success: true, finalMaskUrl: finalPublicUrl, rawResponse: allResults }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error(`[Orchestrator][${requestId}] Error:`, error);
    if (aggregationJobId) {
        await supabase.from('mira-agent-mask-aggregation-jobs').update({ status: 'failed', error_message: error.message }).eq('id', aggregationJobId);
    }
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});