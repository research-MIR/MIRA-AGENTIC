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
const NUM_WORKERS = 10; // Number of parallel API calls

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

const systemPrompt = `You are an expert image analyst specializing in fashion segmentation. Your task is to find a garment in a SOURCE image that is visually similar to a garment in a REFERENCE image and create a highly precise segmentation mask for **only that specific garment**.

### Core Rules:
1.  **Identify the Reference:** Look at the REFERENCE image to understand the target garment's category and appearance (e.g., "a t-shirt", "a pair of jeans", "a blazer").
2.  **Find in Source:** Locate the corresponding garment in the SOURCE image.
3.  **Precision is Paramount:** Create a precise segmentation mask for the garment you found in the SOURCE image.
4.  **Strict No Overlap Rule:** The mask MUST ONLY cover the target garment. It MUST NOT bleed onto other clothing items, skin, or background elements. For example, if the reference is a jacket and the person is also wearing a t-shirt, the mask must *only* cover the jacket.
5.  **Under-covering is Preferable:** It is better for the mask to be slightly smaller and miss a few pixels of the target garment than for it to be too large and cover adjacent areas. Prioritize clean edges.

### Few-Shot Examples:

**Example 1: Blazer over bare chest**
*   **SOURCE IMAGE:** A photo of a man wearing a brown blazer over his bare chest.
*   **REFERENCE IMAGE:** A photo of a brown blazer.
*   **Your Logic:** The reference is a blazer. The man in the source image is wearing a similar blazer. I will create a mask that follows the exact outline of the blazer, carefully avoiding the skin on his chest and neck.
*   **Output:** A single, precise segmentation mask for "the brown jacket/blazer".

**Example 2: Pants**
*   **SOURCE IMAGE:** A photo of a person wearing a white shirt and blue jeans.
*   **REFERENCE IMAGE:** A photo of blue jeans.
*   **Your Logic:** The reference is blue jeans. The person in the source image is wearing blue jeans. I will create a mask that covers only the jeans, stopping precisely at the waistline and **explicitly not overlapping with the white shirt**.
*   **Output:** A single, precise segmentation mask for "the blue jeans".

**Example 3: T-shirt under a jacket**
*   **SOURCE IMAGE:** A photo of a person wearing a red t-shirt underneath an open black jacket.
*   **REFERENCE IMAGE:** A photo of a red t-shirt.
*   **Your Logic:** The reference is a t-shirt. The person in the source image is wearing a matching t-shirt. I will create a mask for the t-shirt, carefully following its outline and **ensuring the mask does not extend onto the black jacket**.
*   **Output:** A single, precise segmentation mask for "the red t-shirt".

### Output Format:
Output a JSON list of segmentation masks where each entry contains the 2D bounding box in the key "box_2d", the segmentation mask in key "mask", and the text label in the key "label".`;

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

    console.log(`[expandMask] Applying multi-draw expansion with amount: ${expansionAmount}px`);
    
    const tempCanvas = createCanvas(canvas.width, canvas.height);
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvas, 0, 0);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const offsets = [
        [0, 0], [-expansionAmount, 0], [expansionAmount, 0], [0, -expansionAmount], [0, expansionAmount],
        [-expansionAmount, -expansionAmount], [expansionAmount, -expansionAmount],
        [-expansionAmount, expansionAmount], [expansionAmount, expansionAmount],
    ];

    ctx.globalAlpha = 0.5;
    for (const [dx, dy] of offsets) {
        ctx.drawImage(tempCanvas, dx, dy);
    }
    ctx.globalAlpha = 1.0;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 0) {
            data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    console.log(`[expandMask] Multi-draw expansion and thresholding complete.`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const { image_base64, mime_type, reference_image_base64, reference_mime_type, user_id, image_dimensions, expansion_percent } = await req.json();
  const requestId = `segment-orchestrator-${Date.now()}`;
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  let aggregationJobId: string | null = null;

  try {
    if (!user_id || !image_base64 || !mime_type || !image_dimensions) {
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
    const contents: Content[] = [{ role: 'user', parts: userParts }];

    const workerPromises = Array.from({ length: NUM_WORKERS }).map((_, i) => 
        ai.models.generateContent({
            model: MODEL_NAME,
            contents: contents,
            generationConfig: { responseMimeType: "application/json" },
            safetySettings,
            config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
        }).then(result => {
            if (!result.text) throw new Error(`Model worker ${i} returned an empty response.`);
            return extractJson(result.text);
        }).catch(err => ({ error: `Worker ${i} failed: ${err.message}` }))
    );

    const settledResults = await Promise.allSettled(workerPromises);
    const allResults = settledResults.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message });
    
    await supabase.from('mira-agent-mask-aggregation-jobs').update({ results: allResults }).eq('id', aggregationJobId);
    console.log(`[Orchestrator][${requestId}] All workers finished. Results saved to DB.`);

    const validRuns = allResults.filter(run => run && !run.error && Array.isArray(run) && run.length > 0);
    if (validRuns.length === 0) throw new Error("No valid mask data found in any of the segmentation runs.");
    
    const firstMasksFromEachRun = validRuns.map(run => run[0]).filter(mask => mask && mask.box_2d && mask.mask);
    if (firstMasksFromEachRun.length === 0) throw new Error("Could not extract any valid masks from the successful runs.");

    const accumulator = new Uint8Array(image_dimensions.width * image_dimensions.height);
    console.log(`[Orchestrator][${requestId}] Created accumulator array for votes.`);

    for (const run of firstMasksFromEachRun) {
        try {
            let base64Data = run.mask;
            if (run.mask.includes(',')) base64Data = run.mask.split(',')[1];
            const imageBuffer = decodeBase64(base64Data);
            const maskImg = await loadImage(imageBuffer);

            const [y0, x0, y1, x1] = run.box_2d;
            const absX0 = Math.floor((x0 / 1000) * image_dimensions.width);
            const absY0 = Math.floor((y0 / 1000) * image_dimensions.height);
            const bboxWidth = Math.ceil(((x1 - x0) / 1000) * image_dimensions.width);
            const bboxHeight = Math.ceil(((y1 - y0) / 1000) * image_dimensions.height);
            
            const tempCanvas = createCanvas(image_dimensions.width, image_dimensions.height);
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(maskImg, absX0, absY0, bboxWidth, bboxHeight);
            
            const imageData = tempCtx.getImageData(0, 0, image_dimensions.width, image_dimensions.height).data;
            for (let i = 0; i < imageData.length; i += 4) {
                if (imageData[i] > 128) {
                    accumulator[i / 4]++;
                }
            }
        } catch (e) {
            console.error(`[Orchestrator][${requestId}] Failed to process a mask. Error: ${e.message}. Skipping.`);
        }
    }
    console.log(`[Orchestrator][${requestId}] Finished processing all masks and accumulating votes.`);

    const combinedCanvas = createCanvas(image_dimensions.width, image_dimensions.height);
    const combinedCtx = combinedCanvas.getContext('2d');
    const combinedImageData = combinedCtx.createImageData(image_dimensions.width, image_dimensions.height);
    const combinedData = combinedImageData.data;
    
    const majorityThreshold = 7;
    for (let i = 0; i < accumulator.length; i++) {
        if (accumulator[i] >= majorityThreshold) {
            const idx = i * 4;
            combinedData[idx] = 255;
            combinedData[idx + 1] = 255;
            combinedData[idx + 2] = 255;
            combinedData[idx + 3] = 255;
        }
    }
    combinedCtx.putImageData(combinedImageData, 0, 0);
    console.log(`[Orchestrator][${requestId}] Majority voting complete with threshold ${majorityThreshold}.`);

    const postVoteExpansion = expansion_percent ?? 0.03;
    console.log(`[Orchestrator][${requestId}] Applying post-vote expansion of ${postVoteExpansion * 100}% to the combined mask.`);
    expandMask(combinedCanvas, postVoteExpansion);
    console.log(`[Orchestrator][${requestId}] Post-vote expansion complete.`);

    const finalImageData = combinedCtx.getImageData(0, 0, image_dimensions.width, image_dimensions.height);
    const finalData = finalImageData.data;
    for (let i = 0; i < finalData.length; i += 4) {
        if (finalData[i] > 128) { finalData[i] = 255; finalData[i + 1] = 0; finalData[i + 2] = 0; finalData[i + 3] = 150; } 
        else { finalData[i + 3] = 0; }
    }
    combinedCtx.putImageData(finalImageData, 0, 0);

    const finalDataUrl = combinedCanvas.toDataURL('image/png');
    if (!finalDataUrl || !finalDataUrl.includes(',')) {
        throw new Error("Failed to generate data URL from final canvas.");
    }
    const finalBase64 = finalDataUrl.split(',')[1];
    const finalImageBuffer = decodeBase64(finalBase64);

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