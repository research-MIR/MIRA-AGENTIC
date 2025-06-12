import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { toolName, toolArgs, restaurantId } = await req.json();
    if (!toolName || !toolArgs || !restaurantId) {
      throw new Error("Missing required parameters: toolName, toolArgs, or restaurantId");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let rpcName = '';
    let rpcParams = {};

    // Map tool names to RPC function names and parameters
    switch (toolName) {
      case 'get_daily_schedule_info':
        rpcName = 'MIRA-AGENT-get_opening_hours';
        rpcParams = { p_restaurant_id: restaurantId, p_target_date: toolArgs.target_date };
        break;
      case 'get_customer_details':
        rpcName = 'MIRA-AGENT-get_customer_details';
        rpcParams = { p_customer_name: toolArgs.customer_name, p_restaurant_id: restaurantId };
        break;
      case 'find_customer_orders':
        rpcName = 'MIRA-AGENT-find_customer_orders';
        rpcParams = { p_customer_name: toolArgs.customer_name, p_target_date: toolArgs.target_date, p_restaurant_id: restaurantId };
        break;
      case 'get_order_status':
        rpcName = 'MIRA-AGENT-get_order_status';
        rpcParams = { p_order_id: toolArgs.order_id };
        break;
      default:
        throw new Error(`Tool '${toolName}' is not a valid database tool.`);
    }

    console.log(`Database Executor: Calling RPC '${rpcName}' with params:`, rpcParams);
    const { data, error } = await supabase.rpc(rpcName, rpcParams);

    if (error) {
      console.error(`RPC Error for ${rpcName}:`, error);
      throw error;
    }

    // Return the raw data from the database
    return new Response(JSON.stringify({ data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("Database Executor Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});