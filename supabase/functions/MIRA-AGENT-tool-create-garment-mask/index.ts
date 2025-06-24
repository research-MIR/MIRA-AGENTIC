import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { createCanvas, loadImage } from 'https://deno.land/x/canvas@v1.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

interface MaskItemData {
    box_2d: [number, number, number, number];
    label: string;
    mask?: string;
}

async function processMasks(
  maskRuns: MaskItemData[][], 
  imageDimensions: { width: number; height: number }
): Promise<string | null> {
  console.log(`[processMasks] Starting to process ${maskRuns.length} mask runs.`);
  if (maskRuns.length === 0) return null;

  const firstMasksFromEachRun = maskRuns.map(run => run[0]).filter(Boolean);
  if (firstMasksFromEachRun.length === 0) return null;
  console.log(`[processMasks] Extracted ${firstMasksFromEachRun.length} primary masks.`);

  const maskImages = await Promise.all(firstMasksFromEachRun.map(run => {
    const imageUrl = run.mask?.startsWith('data:image') ? run.mask : `data:image/png;base64,${run.mask}`;
    return loadImage(imageUrl);
  }));
  console.log(`[processMasks] Loaded ${maskImages.length} mask images into canvas objects.`);

  const fullMaskCanvases = firstMasksFromEachRun.map((run, index) => {
    const maskImg = maskImages[index];
    const [y0, x0, y1, x1] = run.box_2d;
    const absX0 = Math.floor((x0 / 1000) * imageDimensions.width);
    const absY0 = Math.floor((y0 / 1000) * imageDimensions.height);
    const bboxWidth = Math.ceil(((x1 - x0) / 1000) * imageDimensions.width);
    const bboxHeight = Math.ceil(((y1 - y0) / 1000) * imageDimensions.height);

    const fullCanvas = createCanvas(imageDimensions.width, imageDimensions.height);
    const ctx = fullCanvas.getContext('2d');
    ctx.drawImage(maskImg, absX0, absY0, bboxWidth, bboxHeight);
    return fullCanvas;
  });

  const combinedCanvas = createCanvas(imageDimensions.width, imageDimensions.height);
  const combinedCtx = combinedCanvas.getContext('2d');

  const maskImageDatas = fullMaskCanvases.map(c => c.getContext('2d').getImageData(0, 0, imageDimensions.width, imageDimensions.height).data);
  
  const combinedImageData = combinedCtx.createImageData(imageDimensions.width, imageDimensions.height);
  const combinedData = combinedImageData.data;

  for (let i = 0; i < combinedData.length; i += 4) {
      let voteCount = 0;
      for (const data of maskImageDatas) {
          if (data[i] > 128) { // Check red channel
              voteCount++;
          }
      }
      if (voteCount >= 6) {
          combinedData[i] = 255;
          combinedData[i+1] = 255;
          combinedData[i+2] = 255;
          combinedData[i+3] = 255;
      }
  }
  combinedCtx.putImageData(combinedImageData, 0, 0);

  return combinedCanvas.toDataURL().split(',')[1];
}


serve(async (req) => {
  console.log("[CreateGarmentMask] Function invoked.");

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[CreateGarmentMask] Parsing request body...");
    const { image_base64, mime_type, prompt, reference_image_base64, reference_mime_type } = await req.json();
    if (!image_base64 || !mime_type || !prompt) {
      throw new Error("image_base64, mime_type, and prompt are required.");
    }
    console.log("[CreateGarmentMask] Request body parsed successfully.");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    console.log("[CreateGarmentMask] Supabase client created.");

    console.log("[CreateGarmentMask] Loading source image into canvas...");
    const sourceImage = await loadImage(`data:${mime_type};base64,${image_base64}`);
    const imageDimensions = { width: sourceImage.width(), height: sourceImage.height() };
    console.log(`[CreateGarmentMask] Source image loaded. Dimensions: ${imageDimensions.width}x${imageDimensions.height}`);

    const createPayload = () => ({
      image_base64,
      mime_type,
      prompt,
      reference_image_base64,
      reference_mime_type,
    });

    console.log("[CreateGarmentMask] Starting 9 parallel segmentation runs...");
    const promises = Array(9).fill(null).map((_, i) => {
      console.log(`[CreateGarmentMask] Invoking segment-image run #${i + 1}`);
      return supabase.functions.invoke('MIRA-AGENT-tool-segment-image', { body: createPayload() });
    });

    const results = await Promise.allSettled(promises);
    console.log("[CreateGarmentMask] All 9 segmentation runs have completed.");

    const allMasks: MaskItemData[][] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { data, error } = result.value;
        if (error) {
          console.warn(`[CreateGarmentMask] Run ${index + 1} failed with function error: ${error.message}`);
        } else {
          const maskData = data.masks || data;
          if (Array.isArray(maskData) && maskData.length > 0) {
            allMasks.push(maskData);
          } else {
            console.warn(`[CreateGarmentMask] Run ${index + 1} did not return a valid array of masks.`);
          }
        }
      } else {
        console.error(`[CreateGarmentMask] Run ${index + 1} was rejected: ${result.reason}`);
      }
    });
    console.log(`[CreateGarmentMask] Successfully processed ${allMasks.length} valid runs.`);

    if (allMasks.length < 6) {
        throw new Error(`Only ${allMasks.length} of 9 runs succeeded. Not enough data to create a reliable mask.`);
    }

    console.log("[CreateGarmentMask] Processing and combining masks...");
    const finalMaskBase64 = await processMasks(allMasks, imageDimensions);
    console.log("[CreateGarmentMask] Mask combination complete.");

    if (!finalMaskBase64) {
        throw new Error("Failed to process and combine masks.");
    }

    console.log("[CreateGarmentMask] Returning final mask to client.");
    return new Response(JSON.stringify({ final_mask_base64: finalMaskBase64 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[CreateGarmentMask] Unhandled Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});