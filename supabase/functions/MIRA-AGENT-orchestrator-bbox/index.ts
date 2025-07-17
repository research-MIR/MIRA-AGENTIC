import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NUM_WORKERS = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }

  try {
    const { image_url } = await req.json();
    if (!image_url) throw new Error("image_url is required.");

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
    
    const workerPromises = [];
    for (let i = 0; i < NUM_WORKERS; i++) {
        workerPromises.push(supabase.functions.invoke('MIRA-AGENT-worker-vto-get-bbox', {
            body: { image_url }
        }));
    }

    const results = await Promise.allSettled(workerPromises);
    const successfulResults = results
        .filter(r => r.status === 'fulfilled' && r.value.data)
        .map((r: any) => r.value.data);

    if (successfulResults.length === 0) {
        throw new Error("All bounding box detection workers failed.");
    }

    console.log(`Received ${successfulResults.length} successful bounding box results.`);

    // Calculate the average of all returned boxes for a more stable result
    const numResults = successfulResults.length;
    const sumBox = successfulResults.reduce((acc, result) => {
        const box = result.normalized_bounding_box;
        acc.y_min += box[0];
        acc.x_min += box[1];
        acc.y_max += box[2];
        acc.x_max += box[3];
        return acc;
    }, { y_min: 0, x_min: 0, y_max: 0, x_max: 0 });

    const averageBox = {
        y_min: sumBox.y_min / numResults,
        x_min: sumBox.x_min / numResults,
        y_max: sumBox.y_max / numResults,
        x_max: sumBox.x_max / numResults,
    };

    const { width: originalWidth, height: originalHeight } = successfulResults[0].original_dimensions;
    
    const abs_width = ((averageBox.x_max - averageBox.x_min) / 1000) * originalWidth;
    const abs_height = ((averageBox.y_max - averageBox.y_min) / 1000) * originalHeight;

    const basePaddingPercentage = 0.15;
    const longerDim = Math.max(abs_width, abs_height);
    const basePaddingPixels = longerDim * basePaddingPercentage;

    let padding_x: number;
    let padding_y: number;

    if (abs_width < abs_height) {
        padding_x = basePaddingPixels * 2;
        padding_y = basePaddingPixels;
    } else {
        padding_y = basePaddingPixels * 2;
        padding_x = basePaddingPixels;
    }

    const abs_x = (averageBox.x_min / 1000) * originalWidth;
    const abs_y = (averageBox.y_min / 1000) * originalHeight;

    const dilated_x = Math.max(0, abs_x - padding_x / 2);
    const dilated_y = Math.max(0, abs_y - padding_y / 2);
    const dilated_width = Math.min(originalWidth - dilated_x, abs_width + padding_x);
    const dilated_height = Math.min(originalHeight - dilated_y, abs_height + padding_y);

    const absolute_bounding_box = {
        x: Math.round(dilated_x),
        y: Math.round(dilated_y),
        width: Math.round(dilated_width),
        height: Math.round(dilated_height),
    };

    return new Response(JSON.stringify({
        normalized_bounding_box: [averageBox.y_min, averageBox.x_min, averageBox.y_max, averageBox.x_max],
        absolute_bounding_box: absolute_bounding_box,
        original_dimensions: { width: originalWidth, height: originalHeight }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[BBox-Orchestrator] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});