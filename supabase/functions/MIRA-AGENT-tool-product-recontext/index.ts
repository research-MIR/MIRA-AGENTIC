import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleAuth } from "npm:google-auth-library";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GOOGLE_VERTEX_AI_SA_KEY_JSON = Deno.env.get('GOOGLE_VERTEX_AI_SA_KEY_JSON');
const GOOGLE_PROJECT_ID = Deno.env.get('GOOGLE_PROJECT_ID');
const REGION = 'us-central1';
const MODEL_ID = 'imagen-product-recontext-preview-06-30';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!GOOGLE_VERTEX_AI_SA_KEY_JSON || !GOOGLE_PROJECT_ID) {
      throw new Error("Server configuration error: Missing Google Cloud credentials.");
    }

    const { product_images_base64, prompt, product_description, sample_step } = await req.json();
    if (!product_images_base64 || !Array.isArray(product_images_base64) || product_images_base64.length === 0 || !prompt) {
      throw new Error("product_images_base64 (as an array) and prompt are required.");
    }
    if (product_images_base64.length > 3) {
      throw new Error("A maximum of 3 product images are allowed.");
    }

    const auth = new GoogleAuth({
      credentials: JSON.parse(GOOGLE_VERTEX_AI_SA_KEY_JSON),
      scopes: 'https://www.googleapis.com/auth/cloud-platform'
    });
    const accessToken = await auth.getAccessToken();

    const apiUrl = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/locations/${REGION}/publishers/google/models/${MODEL_ID}:predict`;

    const requestBody = {
      instances: [{
        prompt: prompt,
        productImages: product_images_base64.map((base64String: string) => ({
          image: {
            bytesBase64Encoded: base64String
          },
          productConfig: {
            productDescription: product_description || ""
          }
        }))
      }],
      parameters: {
        sampleCount: 1,
        personGeneration: "allow_adult",
        addWatermark: false,
        ...(sample_step && { sampleStep: sample_step })
      }
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Google API Error:", errorBody);
      throw new Error(`API call failed with status ${response.status}: ${errorBody}`);
    }

    const responseData = await response.json();
    const prediction = responseData.predictions?.[0];

    if (!prediction || !prediction.bytesBase64Encoded) {
      throw new Error("API response did not contain a valid image prediction.");
    }

    return new Response(JSON.stringify({
      base64Image: prediction.bytesBase64Encoded,
      mimeType: prediction.mimeType || 'image/png'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    console.error("[ProductRecontextTool] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});