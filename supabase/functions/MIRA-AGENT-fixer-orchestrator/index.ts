import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, GenerationResult, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a VTO Repair Specialist AI. Your task is to analyze a Quality Assurance (QA) report, an original API request payload, and a set of images, then decide on a course of action.

### Your Inputs:
You will receive a prompt containing:
1.  **Image Identifiers:** The original string URLs/IDs for the images.
2.  **Image Data:** The actual visual data for the Source, Reference, and Failed images.
3.  **QA Report:** The analysis of what went wrong.
4.  **Original Payload:** The API request that produced the failed image.

### Your Task:
1.  **Visually Analyze:** Look at the provided image data to understand the failure described in the QA report.
2.  **Formulate a Plan:** Decide whether to 'retry' with a new payload or 'give_up'.
3.  **Construct the Output:**
    -   If retrying, create a new, complete JSON payload. **CRITICAL: In this new payload, you MUST use the original string identifiers (e.g., 'person_image_id', 'mask_image_id') provided in the prompt's text section. DO NOT use the image data itself.**
    -   If giving up, provide a reason.

### Output Format & Rules:
Your entire output MUST be a single, valid JSON object. Do not include any other text or explanations.

**If you decide to retry:**
\`\`\`json
{
  "action": "retry",
  "payload": { ... }
}
\`\`\`
- The "payload" object MUST be the complete, new, corrected JSON payload to be sent to the BitStudio API. Start with the 'original_request_payload' and modify it according to the 'fix_suggestion'.

**If you decide to give up:**
\`\`\`json
{
  "action": "give_up",
  "reason": "A user-friendly explanation for why the automated fix failed."
}
\`\`\`
`;

function extractJson(text: string): any | null {
    if (!text) return null;
    const match = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (match && match[1]) {
        try { return JSON.parse(match[1]); } catch (e) { console.error("Failed to parse extracted JSON block:", e); return null; }
    }
    try { return JSON.parse(text); } catch (e) { return null; }
}

async function downloadAndEncodeImage(supabase: SupabaseClient, url: string): Promise<{ base64: string, mimeType: string }> {
    if (url.includes('supabase.co')) {
        const urlObj = new URL(url);
        const pathSegments = urlObj.pathname.split('/');
        
        const publicSegmentIndex = pathSegments.indexOf('public');
        if (publicSegmentIndex === -1 || publicSegmentIndex + 1 >= pathSegments.length) {
            throw new Error(`Could not parse bucket name from URL: ${url}`);
        }
        
        const bucketName = pathSegments[publicSegmentIndex + 1];
        const filePath = pathSegments.slice(publicSegmentIndex + 2).join('/');

        if (!bucketName || !filePath) {
            throw new Error(`Could not parse bucket or path from Supabase URL: ${url}`);
        }

        const { data: blob, error } = await supabase.storage.from(bucketName).download(filePath);
        if (error) {
            throw new Error(`Failed to download image from Supabase storage (${filePath}): ${error.message}`);
        }
        const buffer = await blob.arrayBuffer();
        const base64 = encodeBase64(buffer);
        return { base64, mimeType: blob.type || 'image/png' };
    } else {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download image from external URL ${url}. Status: ${response.statusText}`);
        }
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        const base64 = encodeBase64(buffer);
        return { base64, mimeType: blob.type || 'image/png' };
    }
}

serve(async (req) => {
  const { job_id } = await req.json();
  if (!job_id) throw new Error("job_id is required for the fixer-orchestrator.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[FixerOrchestrator][${job_id}]`;
  console.log(`${logPrefix} Invoked.`);

  try {
    const { data: job, error: fetchError } = await supabase
      .from('mira-agent-bitstudio-jobs')
      .select('metadata')
      .eq('id', job_id)
      .single();
    if (fetchError) throw fetchError;

    const retryCount = job.metadata?.retry_count || 0;
    const qaHistory = job.metadata?.qa_history || [];
    const fixHistory = job.metadata?.fix_history || [];
    const lastReportObject = qaHistory[qaHistory.length - 1];
    const lastReport = lastReportObject?.report;
    const failedImageUrl = lastReportObject?.failed_image_url;
    const originalPayload = job.metadata?.original_request_payload;
    const sourceImageUrl = job.metadata?.source_image_url;
    const referenceImageUrl = job.metadata?.reference_image_url;

    if (!lastReport) throw new Error("Job is awaiting fix but has no QA report in its history.");
    if (!originalPayload) throw new Error("Job is awaiting fix but has no original_request_payload in its metadata.");

    if (!sourceImageUrl || !referenceImageUrl || !failedImageUrl) {
        console.warn(`${logPrefix} Missing one or more critical URLs for full context. Source: ${!!sourceImageUrl}, Reference: ${!!referenceImageUrl}, Failed: ${!!failedImageUrl}`);
    }

    console.log(`${logPrefix} Current retry count: ${retryCount}. Analyzing last QA report.`);

    if (retryCount >= MAX_RETRIES) {
      console.log(`${logPrefix} Max retries reached. Giving up.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({ 
        status: 'permanently_failed', 
        error_message: 'Automated repair failed after multiple attempts.' 
      }).eq('id', job_id);
      return new Response(JSON.stringify({ success: true, message: "Max retries reached." }), { headers: corsHeaders });
    }

    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'fixing' }).eq('id', job_id);

    console.log(`${logPrefix} Downloading images for multimodal context...`);
    const [sourceData, referenceData, failedData] = await Promise.all([
        downloadAndEncodeImage(supabase, sourceImageUrl),
        downloadAndEncodeImage(supabase, referenceImageUrl),
        downloadAndEncodeImage(supabase, failedImageUrl)
    ]);
    console.log(`${logPrefix} All images downloaded and encoded.`);

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    const geminiInputParts: Part[] = [
        { text: `A VTO job failed quality assurance. Here is the report and the original request payload that caused the failure. Your task is to construct a new, complete payload to fix the issue.` },
        { text: `--- QA REPORT --- \n ${JSON.stringify(lastReport, null, 2)}` },
        { text: `--- ORIGINAL PAYLOAD --- \n ${JSON.stringify(originalPayload, null, 2)}` },
        { text: `--- SOURCE IMAGE ---` },
        { inlineData: { mimeType: sourceData.mimeType, data: sourceData.base64 } },
        { text: `--- REFERENCE GARMENT ---` },
        { inlineData: { mimeType: referenceData.mimeType, data: referenceData.base64 } },
        { text: `--- FAILED RESULT TO ANALYZE ---` },
        { inlineData: { mimeType: failedData.mimeType, data: failedData.base64 } },
    ];
    const contents: Content[] = [{ role: 'user', parts: geminiInputParts }];

    let result: GenerationResult | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`${logPrefix} Calling Gemini model, attempt ${attempt}...`);
            result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: contents,
                generationConfig: { responseMimeType: "application/json" },
                config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
            });
            break;
        } catch (error) {
            if (error.message.includes("503") && attempt < MAX_RETRIES) {
                console.warn(`${logPrefix} Gemini API is overloaded (503). Retrying in ${RETRY_DELAY_MS}ms...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            } else {
                throw error;
            }
        }
    }
    
    if (!result || !result.text) {
        throw new Error("AI planner failed to respond after all retries.");
    }

    console.log(`${logPrefix} Raw Gemini response:`, result.text);
    const plan = extractJson(result.text);
    console.log(`${logPrefix} Parsed plan:`, JSON.stringify(plan, null, 2));

    if (!plan || !plan.action) {
      console.error(`${logPrefix} Orchestrator LLM did not return a valid JSON action. Full raw response:`, result.text);
      throw new Error("Orchestrator LLM did not return a valid JSON action.");
    }

    console.log(`${logPrefix} LLM decided on action: ${plan.action}`);

    const currentFixAttemptLog = {
        timestamp: new Date().toISOString(),
        retry_number: retryCount + 1,
        qa_report_used: lastReportObject,
        gemini_input_prompt: "Multimodal prompt sent (see logs for details)",
        gemini_raw_output: result.text,
        parsed_plan: plan,
    };

    switch (plan.action) {
      case 'retry': {
        const payload = plan.payload;
        if (!payload) throw new Error("Plan action 'retry' is missing the 'payload' parameter.");
        
        console.log(`${logPrefix} Preparing to retry job with new payload.`);
        
        await supabase.from('mira-agent-bitstudio-jobs')
          .update({ 
            metadata: { ...job.metadata, fix_history: [...fixHistory, currentFixAttemptLog] }
          })
          .eq('id', job_id);

        const { error: proxyError } = await supabase.functions.invoke('MIRA-AGENT-proxy-bitstudio', {
          body: {
            retry_job_id: job_id,
            payload: payload,
          }
        });
        if (proxyError) throw proxyError;

        console.log(`${logPrefix} Successfully sent retry request to proxy for job ${job_id}.`);
        break;
      }
      case 'give_up': {
        const reason = plan.reason || 'Automated repair failed after multiple attempts.';
        console.log(`${logPrefix} Agent gave up. Reason: ${reason}. Marking job as permanently_failed.`);
        
        await supabase.from('mira-agent-bitstudio-jobs')
          .update({ 
            status: 'permanently_failed', 
            error_message: reason,
            metadata: { ...job.metadata, fix_history: [...fixHistory, currentFixAttemptLog] }
          })
          .eq('id', job_id);

        if (job.metadata?.batch_pair_job_id) {
            console.log(`${logPrefix} Propagating 'failed' status to parent pair job: ${job.metadata.batch_pair_job_id}`);
            await supabase.from('mira-agent-batch-inpaint-pair-jobs')
                .update({ status: 'failed', error_message: reason })
                .eq('id', job.metadata.batch_pair_job_id);
        }
        break;
      }
      default:
        throw new Error(`Unknown plan action: ${plan.action}`);
    }

    return new Response(JSON.stringify({ success: true, plan }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Fixer orchestrator failed: ${error.message}` }).eq('id', job_id);
    
    // **THE FIX:** Propagate failure to parent job if it exists
    const { data: failedJob } = await supabase.from('mira-agent-bitstudio-jobs').select('metadata').eq('id', job_id).single();
    if (failedJob?.metadata?.batch_pair_job_id) {
        console.log(`${logPrefix} Propagating failure to parent pair job: ${failedJob.metadata.batch_pair_job_id}`);
        await supabase.from('mira-agent-batch-inpaint-pair-jobs')
            .update({ status: 'failed', error_message: `Fixer orchestrator failed: ${error.message}` })
            .eq('id', failedJob.metadata.batch_pair_job_id);
    }

    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});