import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import imageSize from "https://esm.sh/image-size";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const NUM_WORKERS = 5;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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

    const getRobustAverage = (values: number[]): number => {
        if (values.length === 0) return 0;
        if (values.length <= 2) return values.reduce((a, b) => a + b, 0) / values.length;

        const sorted = [...values].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length / 4)];
        const q3 = sorted[Math.floor((sorted.length * 3) / 4)];
        const iqr = q3 - q1;
        
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;

        const filteredValues = sorted.filter(v => v >= lowerBound && v <= upperBound);
        
        if (filteredValues.length === 0) return sorted.reduce((a, b) => a + b, 0) / sorted.length;
        return filteredValues.reduce((a, b) => a + b, 0) / filteredValues.length;
    };

    const yMins = successfulResults.map(r => r.normalized_bounding_box.y_min);
    const xMins = successfulResults.map(r => r.normalized_bounding_box.x_min);
    const yMaxs = successfulResults.map(r => r.normalized_bounding_box.y_max);
    const xMaxs = successfulResults.map(r => r.normalized_bounding_box.x_max);

    const averageBox = {
        y_min: getRobustAverage(yMins),
        x_min: getRobustAverage(xMins),
        y_max: getRobustAverage(yMaxs),
        x_max: getRobustAverage(xMaxs),
    };

    const { width: originalWidth, height: originalHeight } = successfulResults[0].original_dimensions;
    
    const abs_width = ((averageBox.x_max - averageBox.x_min) / 1000) * originalWidth;
    const abs_height = ((averageBox.y_max - averageBox.y_min) / 1000) * originalHeight;

    const paddingPercentage = 0.30; // Increased from 0.20 to 0.30
    const padding_x = abs_width * paddingPercentage;
    const padding_y = abs_height * paddingPercentage;

    const dilated_x_abs = Math.max(0, ((averageBox.x_min / 1000) * originalWidth) - padding_x / 2);
    const dilated_y_abs = Math.max(0, ((averageBox.y_min / 1000) * originalHeight) - padding_y / 2);
    const dilated_width_abs = Math.min(originalWidth - dilated_x_abs, abs_width + padding_x);
    const dilated_height_abs = Math.min(originalHeight - dilated_y_abs, abs_height + padding_y);

    const final_y_min = (dilated_y_abs / originalHeight) * 1000;
    const final_x_min = (dilated_x_abs / originalWidth) * 1000;
    const final_y_max = ((dilated_y_abs + dilated_height_abs) / originalHeight) * 1000;
    const final_x_max = ((dilated_x_abs + dilated_width_abs) / originalWidth) * 1000;

    const finalResponse = {
        "person": [
            Math.round(final_y_min),
            Math.round(final_x_min),
            Math.round(final_y_max),
            Math.round(final_x_max)
        ]
    };

    return new Response(JSON.stringify(finalResponse), {
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