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

    // Function to calculate average after removing outliers using IQR method
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
        
        if (filteredValues.length === 0) {
            return sorted.reduce((a, b) => a + b, 0) / sorted.length;
        }

        return filteredValues.reduce((a, b) => a + b, 0) / filteredValues.length;
    };

    const yMins = successfulResults.map(r => r.normalized_bounding_box[0]);
    const xMins = successfulResults.map(r => r.normalized_bounding_box[1]);
    const yMaxs = successfulResults.map(r => r.normalized_bounding_box[2]);
    const xMaxs = successfulResults.map(r => r.normalized_bounding_box[3]);

    const averageBox = {
        y_min: getRobustAverage(yMins),
        x_min: getRobustAverage(xMins),
        y_max: getRobustAverage(yMaxs),
        x_max: getRobustAverage(xMaxs),
    };

    const { width: originalWidth, height: originalHeight } = successfulResults[0].original_dimensions;
    
    const abs_width = ((averageBox.x_max - averageBox.x_min) / 1000) * originalWidth;
    const abs_height = ((averageBox.y_max - averageBox.y_min) / 1000) * originalHeight;

    const paddingPercentage = 0.20; // 20% padding
    const padding_x = abs_width * paddingPercentage;
    const padding_y = abs_height * paddingPercentage;

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