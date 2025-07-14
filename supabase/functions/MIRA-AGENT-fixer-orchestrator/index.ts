import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Content, GenerationResult, Part } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const BITSTUDIO_API_KEY = Deno.env.get('BITSTUDIO_API_KEY');
const BITSTUDIO_API_BASE = 'https://api.bitstudio.ai';
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1500;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `You are a VTO Repair Specialist AI. Your task is to analyze a Quality Assurance (QA) report and a set of images, then formulate a new, corrected text prompt to fix the failed generation.

### Your Inputs:
You will receive a prompt containing:
1.  **Image Data:** The visual data for the Source, Reference, and Failed images.
2.  **QA Report:** The analysis of what went wrong, including a \`fix_suggestion\`.

### Your Task:
1.  **Visually Analyze:** Look at the provided image data to understand the failure described in the QA report.
2.  **Formulate a New Prompt:** Based on the \`fix_suggestion\` and your visual analysis, create a new, complete, and detailed text-to-image prompt that is likely to fix the issue. The new prompt should incorporate the original intent but add specific details to address the failure.

### Your Output:
Your entire response MUST be a single, valid JSON object with ONE key, "new_prompt".

**Example Output:**
\`\`\`json
{
  "new_prompt": "A photorealistic image of a woman wearing a red silk blouse with a high collar. The silk material should have a subtle, realistic sheen and drape naturally. Preserve the model's face and the studio background."
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
        if (publicSegmentIndex === -1 || publicSegmentIndex + 1 >= pathSegments.length) throw new Error(`Could not parse bucket name from URL: ${url}`);
        const bucketName = pathSegments[publicSegmentIndex + 1];
        const filePath = pathSegments.slice(publicSegmentIndex + 2).join('/');
        if (!bucketName || !filePath) throw new Error(`Could not parse bucket or path from Supabase URL: ${url}`);
        const { data: blob, error } = await supabase.storage.from(bucketName).download(filePath);
        if (error) throw new Error(`Failed to download image from Supabase storage (${filePath}): ${error.message}`);
        const buffer = await blob.arrayBuffer();
        return { base64: encodeBase64(buffer), mimeType: blob.type || 'image/png' };
    } else {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to download image from external URL ${url}. Status: ${response.statusText}`);
        const blob = await response.blob();
        const buffer = await blob.arrayBuffer();
        return { base64: encodeBase64(buffer), mimeType: blob.type || 'image/png' };
    }
}

async function uploadToBitStudio(fileBlob: Blob, type: 'inpaint-base', filename: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', fileBlob, filename);
  formData.append('type', type);
  const response = await fetch(`${BITSTUDIO_API_BASE}/images`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}` },
    body: formData,
  });
  if (!response.ok) throw new Error(`BitStudio upload failed for type ${type}: ${await response.text()}`);
  const result = await response.json();
  if (!result.id) throw new Error(`BitStudio upload for ${type} did not return an ID.`);
  return result.id;
}

serve(async (req) => {
  const { job_id, qa_report_object } = await req.json();
  if (!job_id || !qa_report_object) throw new Error("job_id and qa_report_object are required.");

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const logPrefix = `[FixerOrchestrator][${job_id}]`;
  console.log(`${logPrefix} Invoked.`);

  try {
    const { data: job, error: fetchError } = await supabase.from('mira-agent-bitstudio-jobs').select('metadata').eq('id', job_id).single();
    if (fetchError) throw fetchError;

    const { retry_count = 0, fix_history = [], original_request_payload, source_image_url, reference_image_url, bitstudio_mask_image_id, bitstudio_garment_image_id } = job.metadata || {};
    const { report: lastReport, failed_image_url } = qa_report_object;

    if (!lastReport || !original_request_payload || !source_image_url || !reference_image_url || !failed_image_url || !bitstudio_mask_image_id || !bitstudio_garment_image_id) {
      throw new Error("Job is missing critical metadata for a fix attempt.");
    }

    if (retry_count >= MAX_RETRIES) {
      console.log(`${logPrefix} Max retries reached. Giving up.`);
      await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'permanently_failed', error_message: 'Automated repair failed after multiple attempts.' }).eq('id', job_id);
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
        { text: `A VTO job failed quality assurance. Here is the report and the relevant images. Your task is to formulate a new, corrected text prompt to fix the issue.` },
        { text: `--- QA REPORT --- \n ${JSON.stringify(lastReport, null, 2)}` },
        { text: `--- ORIGINAL SOURCE IMAGE ---` },
        { inlineData: { mimeType: sourceData.mimeType, data: sourceData.base64 } },
        { text: `--- REFERENCE GARMENT ---` },
        { inlineData: { mimeType: referenceData.mimeType, data: referenceData.base64 } },
        { text: `--- FAILED RESULT TO ANALYZE ---` },
        { inlineData: { mimeType: failedData.mimeType, data: failedData.base64 } },
    ];
    const contents: Content[] = [{ role: 'user', parts: geminiInputParts }];

    const result = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
        generationConfig: { responseMimeType: "application/json" },
        config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] } }
    });
    
    if (!result || !result.text) throw new Error("AI planner failed to respond.");
    const plan = extractJson(result.text);
    const newPrompt = plan?.new_prompt;

    if (!newPrompt) {
        console.log(`${logPrefix} AI could not generate a new prompt. Giving up.`);
        await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'permanently_failed', error_message: 'AI could not determine a fix.' }).eq('id', job_id);
        return new Response(JSON.stringify({ success: true, message: "AI gave up." }), { headers: corsHeaders });
    }

    console.log(`${logPrefix} AI generated new prompt. Uploading failed image as new source...`);
    const failedImageBlob = new Blob([decodeBase64(failedData.base64)], { type: failedData.mimeType });
    const newSourceImageId = await uploadToBitStudio(failedImageBlob, 'inpaint-base', 'failed_result_as_source.png');
    console.log(`${logPrefix} New source image ID from BitStudio: ${newSourceImageId}`);

    const newPayload = {
        ...original_request_payload,
        prompt: newPrompt,
        mask_image_id: bitstudio_mask_image_id,
        reference_image_id: bitstudio_garment_image_id,
    };

    const inpaintUrl = `${BITSTUDIO_API_BASE}/images/${newSourceImageId}/inpaint`;
    const inpaintResponse = await fetch(inpaintUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${BITSTUDIO_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(newPayload)
    });
    if (!inpaintResponse.ok) throw new Error(`BitStudio inpaint retry request failed: ${await inpaintResponse.text()}`);
    const inpaintResult = await inpaintResponse.json();
    const newTaskId = inpaintResult.versions?.[0]?.id;
    if (!newTaskId) throw new Error("BitStudio did not return a new task ID on retry.");

    const currentFixAttemptLog = {
        timestamp: new Date().toISOString(),
        retry_number: retryCount + 1,
        qa_report_used: qa_report_object,
        gemini_input_prompt: "Multimodal prompt sent (see logs for details)",
        gemini_raw_output: result.text,
        parsed_plan: plan,
    };

    await supabase.from('mira-agent-bitstudio-jobs').update({
        status: 'queued',
        bitstudio_person_image_id: newSourceImageId,
        bitstudio_task_id: newTaskId,
        metadata: { 
            ...job.metadata, 
            retry_count: retryCount + 1,
            fix_history: [...fixHistory, currentFixAttemptLog],
            original_request_payload: newPayload
        }
    }).eq('id', job_id);

    supabase.functions.invoke('MIRA-AGENT-poller-bitstudio', { body: { job_id } }).catch(console.error);

    return new Response(JSON.stringify({ success: true, plan }), { headers: corsHeaders });

  } catch (error) {
    console.error(`${logPrefix} Error:`, error);
    await supabase.from('mira-agent-bitstudio-jobs').update({ status: 'failed', error_message: `Fixer orchestrator failed: ${error.message}` }).eq('id', job_id);
    
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