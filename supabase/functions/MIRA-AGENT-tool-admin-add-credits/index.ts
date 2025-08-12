import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { user_id, credits_to_add } = await req.json();
    if (!user_id || !credits_to_add) {
      throw new Error("user_id and credits_to_add are required.");
    }
    
    if (typeof credits_to_add !== 'number' || !Number.isInteger(credits_to_add) || credits_to_add <= 0) {
        throw new Error("credits_to_add must be a positive integer.");
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Use an RPC call to increment the value atomically
    const { error } = await supabase.rpc('increment_image_quota', {
        p_user_id: user_id,
        p_credits_to_add: credits_to_add
    });

    if (error) {
      console.error("Error incrementing image quota:", error);
      throw new Error(`Failed to add credits: ${error.message}`);
    }

    const message = `Successfully added ${credits_to_add} credits to user ${user_id}.`;
    console.log(message);

    return new Response(JSON.stringify({ success: true, message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("[AdminAddCredits] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});