import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type, FunctionDeclaration, Content, Part, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const UPLOAD_BUCKET = "mira-agent-user-uploads";
const GENERATED_IMAGES_BUCKET = 'mira-generations';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const getDynamicSystemPrompt = (jobContext: any): string => {
    const language = jobContext?.language === 'it' ? 'Italian' : 'English';
    
    let userPreferences = '';
    if (jobContext?.ratioMode && jobContext.ratioMode !== 'auto') {
        userPreferences += `\n- **Aspect Ratio:** The user has specified a desired aspect ratio of **${jobContext.ratioMode}**. You MUST use this ratio in your \`generate_image\` tool call.`;
    }
    if (jobContext?.numImagesMode && jobContext.numImagesMode !== 'auto') {
        userPreferences += `\n- **Number of Images:** The user has specified they want **${jobContext.numImagesMode}** image(s). You MUST use this number in your \`generate_image\` tool call.`;
    }

    let basePrompt = `You are Mira, a master AI orchestrator. Your purpose is to create and execute a multi-step plan to fulfill a user's request by calling the appropriate tools.

### Core Capabilities
You have several powerful capabilities, each corresponding to a tool or a sequence of tools:
1.  **Creative Production:** Generate highly detailed image prompts and then create images from them, including a self-correction loop for quality control.
2.  **Brand Analysis:** Autonomously research a brand's online presence to understand its visual identity before creating content.
3.  **User-Driven Refinement:** When a user asks to "refine," "improve," or "upscale" an image from the conversation, you can call a special tool to perform this action.
4.  **Conversational Interaction:** Ask clarifying questions or provide final answers to the user.

### Mandatory Rules
1.  **Tool-Use Only:** You MUST ALWAYS respond with a tool call. Never answer the user directly.
2.  **Language:** The final user-facing summary for the \`finish_task\` tool MUST be in **${language}**. All other internal reasoning and tool calls should remain in English.
3.  **Image Descriptions:** After generating images, the history will be updated with a text description for each one. You MUST use these descriptions to understand which image the user is referring to in subsequent requests (e.g., "refine the one with the red dress").
4.  **Avoid Redundant Actions:** If the last action in the history was a successful tool call (e.g., \`dispatch_to_refinement_agent\`), and the user has not provided any new input since then, your only valid next step is to call \`finish_task\` to present the result. Do not call the same tool again on its own output.

---

### Decision-Making Framework

**Step 1: Analyze User Intent (Initial Call)**
-   **IF** the user asks to "refine", "improve", or "upscale" an image...
    -   **THEN** your first and only step is to call \`dispatch_to_refinement_agent\`. You must determine the upscale factor based on their words: "refine" = 1.2, "improve" = 1.4, "upscale" = 2.0 (or the number they specify).
-   **IF** the user asks to analyze a brand, or generate content inspired by a brand (e.g., "create an ad for Nike"), especially if they provide a URL...
    -   **THEN** your first and only step is to call \`dispatch_to_brand_analyzer\`.
-   **ELSE IF** the user provides an image for a creative task (e.g., "make this more cinematic," "use this style")...
    -   **THEN** your first and only step is to call \`dispatch_to_artisan_engine\`.
-   **ELSE IF** the request is a text-only prompt for an image...
    -   **THEN** your first step is to call \`dispatch_to_artisan_engine\` to begin the creative workflow.
-   **ELSE** (if the request is conversational or ambiguous)...
    -   **THEN** call \`finish_task\` to ask for clarification.

**Step 2: Follow the Plan (Subsequent Calls)**
-   **IF** you have just generated multiple images and the user asks to proceed (e.g., "upscale it", "I like the second one"), but their request is ambiguous...
    -   **THEN** you MUST call \`present_image_choice\` to ask them to clarify which image they want to proceed with.
-   **IF** the user has just made a choice (e.g., their last message was "I choose image number 2...")...
    -   **THEN** you MUST look at the conversation history *before* the choice was presented to understand the user's original goal (e.g., they wanted to 'upscale'). Your next step is to execute that original goal on the chosen image. For example, call \`dispatch_to_refinement_agent\` for the selected image.
-   **IF** the last turn in the history is a successful response from a tool like \`dispatch_to_artisan_engine\`, \`generate_image\`, or \`dispatch_to_refinement_agent\`...
    -   **THEN** your next step is to either call the next logical tool (e.g., \`critique_images\` after \`generate_image\`) OR, if the plan is complete, call \`finish_task\` to show the result to the user. Do not call the same tool twice in a row unless the user provides new feedback.

---
### User Preferences
You must respect any of the following preferences set by the user for this job:${userPreferences || " None specified."}`;

    const history = jobContext?.history || [];
    if (history.length > 0) {
        const lastTurn = history[history.length - 1];
        if (lastTurn.role === 'function' && lastTurn.parts[0]?.functionResponse?.name === 'dispatch_to_refinement_agent') {
            basePrompt += `\n\n---
### **IMPORTANT CURRENT CONTEXT**
You have just successfully completed a refinement task. The user has not provided new instructions. Your ONLY valid next action is to call the 'finish_task' tool to present this result to the user. DO NOT call any other tool.`;
        }
    }

    return basePrompt;
};

const modelAspectRatioMap: any = {
    google: ['1024x1024', '768x1408', '1408x768', '1280x896', '896x1280'],
    'fal-ai': ['1:1', '16:9', '9:16', '4:3', '3:4'],
};

async function getDynamicMasterTools(jobContext: any, supabase: SupabaseClient): Promise<FunctionDeclaration[]> {
    let baseTools: FunctionDeclaration[] = [
      { name: "dispatch_to_brand_analyzer", description: "Analyzes a brand's online presence (website, social media) to understand its visual identity. Use this when the user asks to analyze a brand or generate content inspired by a brand, especially if they provide a URL.", parameters: { type: Type.OBJECT, properties: { brand_name: { type: Type.STRING, description: "The name of the brand to analyze." } }, required: ["brand_name"] } },
      { name: "dispatch_to_artisan_engine", description: "Generates or refines a detailed image prompt. This is the correct first step if the user provides a reference image.", parameters: { type: Type.OBJECT, properties: { user_request_summary: { type: Type.STRING, description: "A brief summary of the user's request for the Artisan Engine, noting that a reference image was provided for style/composition." } }, required: ["user_request_summary"] } },
      { 
        name: "dispatch_to_refinement_agent", 
        description: "When the user asks to refine, improve, or upscale an image, call this tool. This is the correct first step if the user provides an image and asks for it to be upscaled.", 
        parameters: { 
            type: Type.OBJECT, 
            properties: { 
                prompt: { type: Type.STRING, description: "The user's original text instruction for refinement, e.g., 'upscale this image'." }, 
                upscale_factor: { type: Type.NUMBER, description: "The upscale factor to use. 1.2 for 'refine', 1.4 for 'upscale', 2.0 for 'improve'." } 
            }, 
            required: ["prompt", "upscale_factor"] 
        } 
      },
      { name: "critique_images", description: "Invokes the Art Director agent to critique generated images.", parameters: { type: Type.OBJECT, properties: { reason_for_critique: { type: Type.STRING, description: "A brief summary of why the critique is necessary." } }, required: ["reason_for_critique"] } },
      { name: "present_image_choice", description: "When you have generated multiple images and need the user to choose one to proceed, call this tool. You MUST provide a summary to ask the user which one they prefer.", parameters: { type: Type.OBJECT, properties: { summary: { type: Type.STRING, description: "The question to ask the user, e.g., 'I've created a couple of options for you. Which one should we refine?'" } }, required: ["summary"] } },
      { name: "finish_task", description: "Call this to respond to the user.", parameters: { type: Type.OBJECT, properties: { response_type: { type: Type.STRING, enum: ["clarification_question", "creative_process_complete", "text"], description: "The type of response to send." }, summary: { type: Type.STRING, description: "The message to send to the user." }, follow_up_message: { type: Type.STRING, description: "A helpful follow-up message." } }, required: ["response_type", "summary"] } },
    ];

    const { data: models, error: modelsError } = await supabase
        .from('mira-agent-models')
        .select('model_id_string, provider, supports_img2img')
        .eq('model_type', 'image');

    if (modelsError) {
        console.error("[MasterWorker] Could not fetch model list for tool definition:", modelsError);
    }
    const modelIdEnum = models ? models.map(m => m.model_id_string) : undefined;

    let selectedModelId = jobContext?.selectedModelId;
    let provider = 'google'; // Default to google if not found
    let supportsImg2Img = false;

    if (selectedModelId) {
        const modelData = models?.find(m => m.model_id_string === selectedModelId);
        if (modelData) {
            provider = modelData.provider.toLowerCase().replace(/\s/g, '-');
            supportsImg2Img = modelData.supports_img2img;
        } else {
            console.warn(`Could not find details for selected model ${selectedModelId}, defaulting to 'google'.`);
        }
    }
    
    const validSizes = modelAspectRatioMap[provider] || modelAspectRatioMap.google;

    const generateImageTool: FunctionDeclaration = {
        name: "generate_image",
        description: "Generates images based on a given TEXT-ONLY prompt and various parameters.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                prompt: { type: Type.STRING, description: "The detailed, final prompt to be used for image generation." },
                size: { type: Type.STRING, description: "The desired image dimensions, formatted as 'WIDTHxHEIGHT' for Google or 'W:H' for Fal.ai.", enum: validSizes },
                number_of_images: { type: Type.NUMBER, description: "The number of images to generate." },
                model_id: { type: Type.STRING, description: "The specific model ID to use for generation.", enum: modelIdEnum },
                negative_prompt: { type: Type.STRING, description: "A description of what to avoid in the image." },
                seed: { type: Type.NUMBER, description: "A seed for deterministic generation." }
            },
            required: ["prompt"]
        }
    };
    
    let allTools = [generateImageTool, ...baseTools];

    const hasReferenceImage = jobContext?.user_provided_assets?.some((asset: any) => asset.type === 'image');
    if (hasReferenceImage && supportsImg2Img) {
        console.log(`[MasterWorker] Context has reference image and model supports img2img. Adding 'generate_image_with_reference' tool.`);
        const generateWithReferenceTool: FunctionDeclaration = {
            name: "generate_image_with_reference",
            description: "Generates an image using a user-provided reference image and a text prompt. Only use this if the user has uploaded an image.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    prompt: { type: Type.STRING, description: "A text prompt that describes the desired modifications or the scene for the reference image." },
                    model_id: { type: Type.STRING, description: "The specific model ID to use for generation.", enum: modelIdEnum },
                    aspect_ratio: { type: Type.STRING, description: "The desired aspect ratio, e.g., '1:1', '16:9'." }
                },
                required: ["prompt"]
            }
        };
        allTools.push(generateWithReferenceTool);
    }

    // Check if the last action was a successful refinement to prevent loops
    const history = jobContext?.history || [];
    if (history.length > 0) {
        const lastTurn = history[history.length - 1];
        if (lastTurn.role === 'function' && lastTurn.parts[0]?.functionResponse?.name === 'dispatch_to_refinement_agent') {
            console.log("[MasterWorker] Last action was a refinement. Temporarily removing refinement tool to prevent loop.");
            allTools = allTools.filter(tool => tool.name !== 'dispatch_to_refinement_agent');
        }
    }

    return allTools;
}

function getMimeType(filePath: string): string | null {
    const extension = filePath.split('.').pop()?.toLowerCase();
    if (!extension) return null;

    switch (extension) {
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'webp': return 'image/webp';
        case 'gif': return 'image/gif';
        case 'pdf': return 'application/pdf';
        case 'txt': return 'text/plain';
        default: return null;
    }
}

function parseRatio(ratioStr: string): number {
    let parts: number[];
    if (ratioStr.includes(':')) {
        parts = ratioStr.split(':').map(Number);
    } else if (ratioStr.includes('x')) {
        parts = ratioStr.split('x').map(Number);
    } else {
        return 1; // Cannot parse
    }

    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1]) || parts[1] === 0) {
        return 1; // Default to 1:1 if invalid
    }
    return parts[0] / parts[1];
}

function mapToClosestRatio(targetRatioStr: string, supportedRatios: string[]): string {
    const targetRatio = parseRatio(targetRatioStr);
    let closestRatio = supportedRatios[0];
    let minDiff = Infinity;

    for (const supported of supportedRatios) {
        const diff = Math.abs(targetRatio - parseRatio(supported));
        if (diff < minDiff) {
            minDiff = diff;
            closestRatio = supported;
        }
    }
    console.log(`[MasterWorker] Mapped target ratio '${targetRatioStr}' to closest supported ratio: '${closestRatio}'`);
    return closestRatio;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  
  const { job_id, prompt, storagePaths, userId, isDesignerMode, pipelineMode, selectedModelId, language, ratioMode, numImagesMode } = await req.json();
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let currentJobId = job_id;

  try {
    if (!currentJobId) {
      console.log("[MasterWorker] Handling new job creation.");
      if (!prompt) throw new Error("A 'prompt' is required for new jobs.");
      if (!userId) throw new Error("A 'userId' is required for new jobs.");

      const userParts: Part[] = [{ text: prompt }];
      const userProvidedAssets: any[] = [];

      if (storagePaths && Array.isArray(storagePaths)) {
          for (const path of storagePaths) {
              const mimeType = getMimeType(path);
              if (mimeType) {
                  const { data: fileBlob, error: downloadError } = await supabase.storage.from(UPLOAD_BUCKET).download(path);
                  if (downloadError) throw new Error(`Failed to download file from storage: ${downloadError.message}`);
                  const arrayBuffer = await fileBlob.arrayBuffer();
                  const base64String = encodeBase64(arrayBuffer);
                  const originalName = path.split('/').pop();
                  userParts.push({ inlineData: { mimeType: mimeType, data: base64String, name: originalName } });
                  userProvidedAssets.push({ type: 'image', storagePath: path, originalName: originalName });
              }
          }
      }
      
      console.log(`[MasterWorker] Creating Asset Manifest with ${userProvidedAssets.length} items.`);
      console.log(`[MasterWorker] Created userParts with ${userParts.length} parts.`);

      const { data: newJob, error: createError } = await supabase
        .from('mira-agent-jobs')
        .insert({ 
            original_prompt: prompt, 
            status: 'processing', 
            user_id: userId,
            context: { 
                history: [{ role: "user", parts: userParts }], 
                user_provided_assets: userProvidedAssets,
                iteration_number: 1,
                safety_retry_count: 0,
                isDesignerMode: isDesignerMode,
                pipelineMode: pipelineMode,
                selectedModelId: selectedModelId,
                language: language || 'it',
                ratioMode: ratioMode,
                numImagesMode: numImagesMode,
                source: 'agent'
            } 
        })
        .select()
        .single();
      
      if (createError) throw createError;
      currentJobId = newJob.id;
      console.log(`[MasterWorker][${currentJobId}] Job created in DB successfully.`);
      
      console.log(`[MasterWorker][${currentJobId}] Invoking chat titler in the background...`);
      supabase.functions.invoke('MIRA-AGENT-tool-generate-chat-title', {
        body: { job_id: currentJobId, user_parts: userParts }
      }).catch(err => console.error(`[MasterWorker][${currentJobId}] Error invoking chat titler:`, err));

      console.log(`[MasterWorker][${currentJobId}] Kicking off main job processing...`);
      supabase.functions.invoke('MIRA-AGENT-master-worker', { body: { job_id: currentJobId } }).catch(console.error);
      
      console.log(`[MasterWorker][${currentJobId}] Preparing to return response to client.`);
      return new Response(JSON.stringify({ reply: { type: 'job_started', jobId: currentJobId, message: "Thinking..." } }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[MasterWorker][${currentJobId}] Continuing job...`);
    const { data: job, error: fetchError } = await supabase.from('mira-agent-jobs').select('*').eq('id', currentJobId).single();
    if (fetchError) throw fetchError;

    if (job.status !== 'processing') {
        console.log(`[MasterWorker][${currentJobId}] Worker invoked for a job with status '${job.status}'. Halting execution as it's not 'processing'.`);
        return new Response(JSON.stringify({ success: true, message: `Job status is ${job.status}, worker halted.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    let history: Content[] = job.context?.history || [];
    let iterationNumber = job.context?.iteration_number || 1;
    
    // Check for and inject a pending user choice into the history for the planner
    if (job.context?.pending_user_choice) {
        console.log(`[MasterWorker][${currentJobId}] Found pending user choice. Injecting into history for planner.`);
        history.push({ role: 'user', parts: [{ text: job.context.pending_user_choice }] });
        // Clear it from the context immediately after processing it
        const { error: updateError } = await supabase.from('mira-agent-jobs').update({
            context: { ...job.context, pending_user_choice: undefined }
        }).eq('id', currentJobId);
        if (updateError) console.error(`[MasterWorker][${currentJobId}] Failed to clear pending_user_choice:`, updateError);
    }

    console.log(`[MasterWorker][${currentJobId}] History has ${history.length} turns. Iteration: ${iterationNumber}. Preparing to send to Gemini planner.`);
    console.log(`[MasterWorker][${currentJobId}] Full history being sent to planner:`, JSON.stringify(history, null, 2));
    
    const dynamicTools = await getDynamicMasterTools(job.context, supabase);
    const systemPrompt = getDynamicSystemPrompt(job.context);

    let result: GenerationResult | null = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[MasterWorker][${currentJobId}] Calling Gemini planner, attempt ${attempt}...`);
        result = await ai.models.generateContent({
          model: MODEL_NAME,
          contents: history,
          config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }, tools: [{ functionDeclarations: dynamicTools }] }
        });
        break;
      } catch (error) {
        console.warn(`[MasterWorker][${currentJobId}] Planner attempt ${attempt} failed:`, error.message);
        if (attempt === MAX_RETRIES) throw error;
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }

    if (!result) throw new Error("AI planner failed to respond after all retries.");

    const functionCalls = result.functionCalls;
    if (!functionCalls || functionCalls.length === 0) throw new Error("Orchestrator did not return a tool call.");

    const call = functionCalls[0];
    console.log(`[MasterWorker][${currentJobId}] Gemini decided to call tool: ${call.name} with args:`, call.args);
    history.push({ role: 'model', parts: [{ functionCall: call }] });
    
    let toolResponseData;
    const historyParts: Part[] = [];

    if (call.name === 'dispatch_to_brand_analyzer') {
        console.log(`[MasterWorker][${currentJobId}] Dispatching to brand analyzer...`);
        await supabase.from('mira-agent-jobs').update({ 
            context: { ...job.context, brand_name: call.args.brand_name } 
        }).eq('id', currentJobId);

        const { error } = await supabase.functions.invoke('MIRA-AGENT-executor-brand-analyzer', { body: { job_id: currentJobId } });
        if (error) throw error;

        return new Response(JSON.stringify({ success: true, message: "Brand analysis initiated." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (call.name === 'generate_image') {
        console.log(`[MasterWorker][${currentJobId}] Dispatching to text-to-image generator...`);
        const finalModelId = job.context?.selectedModelId;
        if (!finalModelId) throw new Error("Cannot generate image without a selected model in the job context.");
        
        const { data: modelDetails } = await supabase.from('mira-agent-models').select('provider').eq('model_id_string', finalModelId).single();
        const provider = modelDetails?.provider.toLowerCase().replace(/\s/g, '-') || 'google';
        
        const payload: { [key: string]: any } = {
            prompt: call.args.prompt,
            negative_prompt: call.args.negative_prompt,
            seed: call.args.seed,
            model_id: finalModelId,
            invoker_user_id: job.user_id
        };

        if (job.context.numImagesMode && job.context.numImagesMode !== 'auto') {
            payload.number_of_images = job.context.numImagesMode;
        } else if (call.args.number_of_images) {
            payload.number_of_images = call.args.number_of_images;
        }

        if (job.context.ratioMode && job.context.ratioMode !== 'auto') {
            const supportedRatios = modelAspectRatioMap[provider] || modelAspectRatioMap.google;
            payload.size = mapToClosestRatio(job.context.ratioMode, supportedRatios);
        } else if (call.args.size) {
            payload.size = call.args.size;
        }

        const toolToInvoke = 'MIRA-AGENT-tool-generate-image-google';
        console.log(`[MasterWorker][${currentJobId}] Invoking tool: ${toolToInvoke} with sanitized payload:`, payload);
        const { data, error } = await supabase.functions.invoke(toolToInvoke, { body: payload });
        if (error) throw error;
        toolResponseData = data;
        historyParts.push({ functionResponse: { name: call.name, response: toolResponseData } });

    } else if (call.name === 'dispatch_to_refinement_agent') {
        console.log(`[MasterWorker][${currentJobId}] Dispatching to refinement agent...`);
        let { prompt, upscale_factor } = call.args;

        // Robustness: If the model fails to provide the prompt, find the last user message.
        if (!prompt) {
            const lastUserTurn = [...history].reverse().find(turn => turn.role === 'user');
            if (lastUserTurn) {
                const textPart = lastUserTurn.parts.find((p: any) => p.text);
                if (textPart) {
                    prompt = textPart.text;
                    console.log(`[MasterWorker][${currentJobId}] Model did not provide a prompt. Extracted from history: "${prompt}"`);
                }
            }
        }

        if (!prompt) {
            // If still no prompt, we can't proceed.
            throw new Error("Could not determine the refinement prompt from the model's call or the conversation history.");
        }

        const { error } = await supabase.functions.invoke('MIRA-AGENT-executor-refinement', {
            body: {
                job_id: currentJobId,
                prompt,
                upscale_factor
            }
        });
        if (error) throw error;

        // The refinement executor will pause the job, so we just return here.
        return new Response(JSON.stringify({ success: true, message: "Refinement job dispatched." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (call.name === 'dispatch_to_artisan_engine' || call.name === 'critique_images') {
        const toolName = call.name === 'dispatch_to_artisan_engine' ? 'MIRA-AGENT-tool-generate-image-prompt' : 'MIRA-AGENT-tool-critique-images';
        const payload = { body: { history: history, iteration_number: iterationNumber, is_designer_mode: job.context?.isDesignerMode } };
        console.log(`[MasterWorker][${currentJobId}] Invoking ${toolName} with payload...`);
        const { data, error } = await supabase.functions.invoke(toolName, { body: payload.body });
        if (error) throw error;
        toolResponseData = data;
        historyParts.push({ functionResponse: { name: call.name, response: toolResponseData } });

        if (call.name === 'critique_images' && data.is_good_enough === false) {
            iterationNumber++;
            console.log(`[MasterWorker][${currentJobId}] Critique rejected. Incrementing iteration to ${iterationNumber}.`);
        }
    } else if (call.name === 'present_image_choice') {
        console.log(`[MasterWorker][${currentJobId}] Presenting image choice to user.`);
        
        const lastGenerationTurn = [...history].reverse().find(turn => 
            turn.role === 'function' && 
            (turn.parts[0]?.functionResponse?.name === 'generate_image' || turn.parts[0]?.functionResponse?.name === 'generate_image_with_reference') &&
            turn.parts[0]?.functionResponse?.response?.images
        );

        if (!lastGenerationTurn) {
            throw new Error("Agent tried to present a choice, but no generated images were found in history.");
        }

        const images = lastGenerationTurn.parts[0].functionResponse.response.images;
        const finalResult = {
            isImageChoiceProposal: true,
            summary: call.args.summary,
            images: images
        };

        await supabase.from('mira-agent-jobs').update({
            status: 'awaiting_feedback',
            final_result: finalResult
        }).eq('id', currentJobId);

        console.log(`[MasterWorker][${currentJobId}] Job status set to 'awaiting_feedback' with an image choice proposal.`);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (call.name === 'finish_task') {
        const { response_type, summary, follow_up_message } = call.args;
        let finalResult;
        let finalStatus = 'complete';

        console.log(`[MasterWorker][${currentJobId}] Finish task called with type: ${response_type}.`);
        if (response_type === 'creative_process_complete') {
            finalResult = { isCreativeProcess: true };
        } else {
            finalResult = { text: summary };
        }
        
        if (response_type === 'clarification_question') {
            finalStatus = 'awaiting_feedback';
        }
        
        if (follow_up_message) finalResult.follow_up_message = follow_up_message;

        await supabase.from('mira-agent-jobs').update({ status: finalStatus, final_result: finalResult, context: { ...job.context, history, iteration_number: iterationNumber } }).eq('id', currentJobId);
        console.log(`[MasterWorker][${currentJobId}] Job status set to '${finalStatus}'. Job is complete.`);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      throw new Error(`Master worker received unknown tool call: ${call.name}`);
    }
    
    history.push({ role: 'function', parts: historyParts });
    await supabase.from('mira-agent-jobs').update({ context: { ...job.context, history: history, iteration_number: iterationNumber }, status: 'processing' }).eq('id', currentJobId);
    
    console.log(`[MasterWorker][${currentJobId}] Step complete. Invoking next step...`);
    supabase.functions.invoke('MIRA-AGENT-master-worker', { body: { job_id: currentJobId } });
    
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(`[MasterWorker] FATAL ERROR for job ${currentJobId}:`, error);
    if (currentJobId) await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: error.message }).eq('id', currentJobId);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});