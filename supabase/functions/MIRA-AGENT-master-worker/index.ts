import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { GoogleGenAI, Type, FunctionDeclaration, Content, Part, GenerationResult } from 'https://esm.sh/@google/genai@0.15.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const MODEL_NAME = "gemini-2.5-pro-preview-06-05";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const HISTORY_SLICE_FOR_TOOLS = 20;
const MAX_TOKEN_THRESHOLD = 130000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const modelAspectRatioMap: any = {
    google: ['1024x1024', '768x1408', '1408x768', '1280x896', '896x1280'],
    'fal.ai': ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'],
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

    const baseRules = `You are Mira, a master AI orchestrator. Your purpose is to create and execute a plan to fulfill a user's request by calling the appropriate tools.

### Core Capabilities
You have several powerful capabilities, each corresponding to a tool or a sequence of tools:
1.  **Creative Production:** Generate highly detailed image prompts and then create images from them.
2.  **Brand Analysis:** Autonomously research a brand's online presence to understand its visual identity before creating content.
3.  **User-Driven Upscaling:** When a user asks to "upscale," "improve," or "refine" an image from the conversation, you can call a special tool to perform this action.
4.  **Conversational Interaction:** Ask clarifying questions or provide final answers to the user.

### Mandatory Rules
1.  **Tool-Use Only:** You MUST ALWAYS respond with a tool call. Never answer the user directly.
2.  **Language:** The final user-facing summary for the \`finish_task\` tool MUST be in **${language}**. All other internal reasoning and tool calls should remain in English.
3.  **Image Descriptions:** After generating images, the history will be updated with a text description for each one. You MUST use these descriptions to understand which image the user is referring to in subsequent requests (e.g., "refine the one with the red dress").
4.  **The "finish_task" Imperative:** After a successful tool execution (like \`dispatch_to_artisan_engine\`, \`generate_image\`, or \`dispatch_to_refinement_agent\`), if the plan is complete and there is no new, unaddressed user feedback following it in the history, you MUST call \`finish_task\` to present the final result. Do not call another tool unless the user has provided new instructions.
---
`;

    const improvementLogic = `
### **Primary Directive: Interpreting Follow-up Requests**
Your most critical task after presenting images is to correctly interpret the user's follow-up request. You must analyze the *intent* behind their words to differentiate between a request for a **new creative direction** and a request for a **quality enhancement**.

#### **Category 1: New Creative Direction (Re-generation)**
This is when the user wants to **change the content, composition, or style** of the image.
*   **User Intent:** They are asking for a *different* image.
*   **Examples:** "Make it more cinematic," "change the background," "move the face downwards," "can you add a hat?".
*   **Your Action:** The prompt needs to be updated. Call \`dispatch_to_artisan_engine\`.

#### **Category 2: Quality Enhancement (Upscaling)**
This is when the user is happy with the image's content and wants to improve its **technical quality**.
*   **User Intent:** They want the *same* image, but better (sharper, higher resolution).
*   **Examples:** "I love it, make it better," "upscale this one," "improve the resolution," "migliorala."
*   **Your Action:** The prompt is fine. Call \`dispatch_to_refinement_agent\`.

### **Decision Tree for Handling User Feedback Post-Generation**
1.  **Analyze the user's prompt.** Is it a request to change the content/style (Category 1) or a request to improve quality (Category 2)?
2.  **Check for Ambiguity.** Did the previous turn present more than one image?
    *   **YES:** If the request is ambiguous (e.g., uses pronouns like 'it', 'that one', or a general command like 'upscale'), you MUST call \`present_image_choice\` to ask the user to select the specific image they want to enhance.
    *   **NO (only one image was shown):** The request is unambiguous. You can proceed directly with the appropriate tool call (\`dispatch_to_artisan_engine\` for Category 1, or \`dispatch_to_refinement_agent\` for Category 2).
---
`;

    if (jobContext?.isDesignerMode) {
        return `
${baseRules}
${improvementLogic}
### HIGHEST PRIORITY: DESIGNER MODE (THE ART DIRECTOR)
You are currently in **Designer Mode**. Your persona is that of a world-class, proactive Art Director. You are expected to take the lead, propose a creative vision, and hold your own work to uncompromising standards.

#### Example Conversation Flow:
This is how you should think and act.

**Turn 1 - User:** "Generate a photorealistic image of a knight in a dark forest."
**Turn 2 - Your Thought Process:** The user's request is clear but simple. As an Art Director, I should propose a more ambitious creative vision before starting.
**Turn 2 - Your Action:** Call \`finish_task\` with the summary: "Okay, a knight in a forest. I think we should aim for a moody, cinematic feel with dramatic, low-key lighting. I'll start by generating a prompt that captures that. Sound good?"

**Turn 3 - User:** "Sounds good."
**Turn 4 - Your Thought Process:** The user has approved my creative direction. Now I will execute the plan. First step is to generate a detailed prompt.
**Turn 4 - Your Action:** Call \`dispatch_to_artisan_engine\`.
**Turn 5 - Function Response:** (ArtisanEngine returns a detailed prompt).
**Turn 6 - Your Thought Process:** I have the prompt. Now I will generate the image.
**Turn 6 - Your Action:** Call \`generate_image\` with the prompt from the previous step.
**Turn 7 - Function Response:** (Images are generated).
**Turn 8 - Your Thought Process:** The images are generated. As an Art Director, I MUST critique my own work before showing it to the user.
**Turn 8 - Your Action:** Call \`critique_images\`.
**Turn 9 - Function Response:** (Critique comes back, let's say it's negative: "The lighting is too bright.").
**Turn 10 - Your Thought Process:** My self-critique failed. I must inform the user and refine the plan.
**Turn 10 - Your Action:** Call \`finish_task\` with the summary: "The first attempt was a bit too bright. I'm refining the prompt to add more dramatic, low-key lighting and will try again."
**Turn 11 - Your Thought Process:** Now I will loop back and re-run the Artisan Engine with the new context.
**Turn 11 - Your Action:** Call \`dispatch_to_artisan_engine\` again.
(The loop continues until the critique is positive, at which point you call \`finish_task\` to present the final result).

**User Preferences:**
You must respect any of the following preferences set by the user for this job:${userPreferences || " None specified."}
`;
    } else {
        return `
${baseRules}
${improvementLogic}
### HIGHEST PRIORITY: ASSISTANT MODE (THE COLLABORATOR)
You are currently in **Assistant Mode**. Your primary goal is to be a helpful, conversational, and collaborative partner. You are a faithful executor. Your default is to listen and clarify, not to be proactive.

#### Example Conversation Flow:
This is how you should think and act.

**Turn 1 - User:** "Make me a picture of a cool car."
**Turn 2 - Your Thought Process:** The user's request is too vague. I need more details to create a good image. I must ask clarifying questions.
**Turn 2 - Your Action:** Call \`finish_task\` with \`response_type: 'clarification_question'\` and the summary: "I can certainly do that! What kind of car are you thinking of? A modern sports car, a vintage model? And what kind of setting should it be in?"

**Turn 3 - User:** "A red Ferrari on a coastal road at sunset."
**Turn 4 - Your Thought Process:** The user has provided specific details. My next step is to generate a detailed prompt based on this.
**Turn 4 - Your Action:** Call \`dispatch_to_artisan_engine\`.
**Turn 5 - Function Response:** (ArtisanEngine returns a detailed prompt).
**Turn 6 - Your Thought Process:** I have the prompt. Now I will generate the image.
**Turn 6 - Your Action:** Call \`generate_image\` with the prompt from the previous step.
**Turn 7 - Function Response:** (Images are generated).
**Turn 8 - Your Thought Process:** The image generation is complete. My job is to present the results to the user and wait for their feedback.
**Turn 8 - Your Action:** Call \`finish_task\` to show the user the generated images.

**User Preferences:**
You must respect any of the following preferences set by the user for this job:${userPreferences || " None specified."}
`;
    }
};

async function getDynamicMasterTools(jobContext: any, supabase: SupabaseClient): Promise<FunctionDeclaration[]> {
    const baseTools: FunctionDeclaration[] = [
      { name: "dispatch_to_brand_analyzer", description: "Analyzes a brand's online presence (website, social media) to understand its visual identity. Use this when the user asks to analyze a brand or generate content inspired by a brand, especially if they provide a URL.", parameters: { type: Type.OBJECT, properties: { brand_name: { type: Type.STRING, description: "The name of the brand to analyze." } }, required: ["brand_name"] } },
      { name: "dispatch_to_artisan_engine", description: "Generates or refines a detailed image prompt. This is the correct first step if the user provides a reference image.", parameters: { type: Type.OBJECT, properties: { user_request_summary: { type: Type.STRING, description: "A brief summary of the user's request for the Artisan Engine, noting that a reference image was provided for style/composition." } }, required: ["user_request_summary"] } },
      { name: "dispatch_to_refinement_agent", description: "Upscales an image's resolution and clarity. It does NOT change the content. Only call this when the user explicitly asks to 'upscale', 'improve quality', or 'make higher resolution'. If there are multiple images in the conversation history, you MUST first call `present_image_choice` to have the user confirm which image to upscale.", parameters: { type: Type.OBJECT, properties: { prompt: { type: Type.STRING, description: "The user's instructions for refinement." }, upscale_factor: { type: Type.NUMBER, description: "The upscale factor to use. 1.2 for 'refine', 1.4 for 'upscale', 2.0 for 'improve'." } }, required: ["prompt", "upscale_factor"] } },
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
            provider = modelData.provider.toLowerCase().replace(/[^a-z0-9.-]/g, '');
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
    
    const allTools = [generateImageTool, ...baseTools];

    if (jobContext?.isDesignerMode) {
        console.log("[MasterWorker] Designer Mode is ON. Adding critique_images tool.");
        const critiqueTool: FunctionDeclaration = {
            name: "critique_images",
            description: "Invokes the Art Director agent to critique generated images. This should only be called after 'generate_image' when in Designer Mode.",
            parameters: {
                type: Type.OBJECT,
                properties: {
                    reason_for_critique: {
                        type: Type.STRING,
                        description: "A brief summary of why the critique is necessary (e.g., 'First pass generation complete, proceeding to critique.')."
                    }
                },
                required: ["reason_for_critique"]
            }
        };
        allTools.push(critiqueTool);
    }

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

    return allTools;
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

function assembleCreativeProcessResult(history: Content[]): any {
    const iterations: any[] = [];
    let currentIteration: any = {};

    for (const turn of history) {
        if (turn.role === 'function') {
            const callName = turn.parts[0]?.functionResponse?.name;
            const response = turn.parts[0]?.functionResponse?.response;

            if (!response || !callName) continue;

            switch (callName) {
                case 'dispatch_to_artisan_engine':
                    if (Object.keys(currentIteration).length > 0) {
                        iterations.push(currentIteration);
                    }
                    currentIteration = { artisan_result: response };
                    break;
                case 'generate_image':
                case 'generate_image_with_reference':
                    if (currentIteration.initial_generation_result) {
                        currentIteration.refined_generation_result = { toolName: callName, response };
                    } else {
                        currentIteration.initial_generation_result = { toolName: callName, response };
                    }
                    break;
                case 'critique_images':
                    currentIteration.critique_result = response;
                    break;
            }
        }
    }

    if (Object.keys(currentIteration).length > 0) {
        iterations.push(currentIteration);
    }

    if (iterations.length === 0) {
        return null;
    }

    const lastIteration = iterations[iterations.length - 1];
    const final_generation_result = lastIteration.refined_generation_result || lastIteration.initial_generation_result;

    return {
        isCreativeProcess: true,
        iterations: iterations,
        final_generation_result: final_generation_result,
    };
}

function getValidHistorySliceForTool(fullHistory: Content[], maxLength: number): Content[] {
    const slicedHistory: Content[] = [];
    for (let i = fullHistory.length - 1; i >= 0; i--) {
        const currentTurn = fullHistory[i];
        
        if (currentTurn.role === 'function') {
            const modelTurn = fullHistory[i - 1];
            if (i > 0 && modelTurn.role === 'model' && modelTurn.parts[0]?.functionCall) {
                slicedHistory.unshift(modelTurn, currentTurn);
                i--;
            }
        } else {
            slicedHistory.unshift(currentTurn);
        }

        if (slicedHistory.length >= maxLength) {
            break;
        }
    }

    const firstUserIndex = slicedHistory.findIndex(turn => turn.role === 'user');
    if (firstUserIndex > 0) {
        return slicedHistory.slice(firstUserIndex);
    } else if (firstUserIndex === -1) {
        return []; 
    }

    return slicedHistory;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response(null, { headers: corsHeaders }); }
  
  const { job_id } = await req.json();
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);
  const currentJobId = job_id;

  try {
    if (!currentJobId) {
      throw new Error("MIRA-AGENT-master-worker requires a job_id to run.");
    }

    console.log(`[MasterWorker][${currentJobId}] Continuing job...`);
    
    let job = null;
    let fetchError = null;
    for (let i = 0; i < MAX_RETRIES; i++) {
        const { data, error } = await supabase.from('mira-agent-jobs').select('*').eq('id', currentJobId).single();
        if (!error) {
            job = data;
            fetchError = null;
            break;
        }
        fetchError = error;
        console.warn(`[MasterWorker][${currentJobId}] Failed to fetch job, attempt ${i+1}. Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    }

    if (fetchError || !job) {
        throw fetchError || new Error("Failed to fetch job data after multiple retries.");
    }

    if (job.status !== 'processing') {
        console.log(`[MasterWorker][${currentJobId}] Worker invoked for a job with status '${job.status}'. Halting execution as it's not 'processing'.`);
        return new Response(JSON.stringify({ success: true, message: `Job status is ${job.status}, worker halted.` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY! });
    let currentContext = { ...job.context };
    let history: Content[] = currentContext.history || [];
    let iterationNumber = currentContext.iteration_number || 1;
    
    if (currentContext.pending_user_choice) {
        console.log(`[MasterWorker][${currentJobId}] Found pending user choice. Injecting into history.`);
        history.push({ role: 'user', parts: [{ text: currentContext.pending_user_choice }] });
        delete currentContext.pending_user_choice;
        currentContext.history = history;
    }

    console.log(`[MasterWorker][${currentJobId}] History has ${history.length} turns. Iteration: ${iterationNumber}. Preparing to send to Gemini planner.`);
    
    const dynamicTools = await getDynamicMasterTools(currentContext, supabase);
    const systemPrompt = getDynamicSystemPrompt(currentContext);
    
    console.log(`[MasterWorker][${currentJobId}] USING SYSTEM PROMPT:\n---\n${systemPrompt}\n---`);

    let result: GenerationResult | null = null;
    let functionCalls: any = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[MasterWorker][${currentJobId}] Calling Gemini planner, attempt ${attempt}...`);
        
        try {
            result = await ai.models.generateContent({
                model: MODEL_NAME,
                contents: history,
                config: { systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }, tools: [{ functionDeclarations: dynamicTools }] }
            });
        } catch (apiError) {
            console.warn(`[MasterWorker][${currentJobId}] Planner API call attempt ${attempt} failed:`, apiError.message);
            if (attempt === MAX_RETRIES) throw apiError;
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            continue;
        }

        functionCalls = result?.functionCalls;

        if (functionCalls && functionCalls.length > 0) {
            console.log(`[MasterWorker][${currentJobId}] Successfully received tool call on attempt ${attempt}.`);
            break;
        } else {
            console.warn(`[MasterWorker][${currentJobId}] Planner did not return a tool call on attempt ${attempt}. Response was:`, result?.text || "No text response.");
            
            if (attempt < MAX_RETRIES) {
                history.push({
                    role: 'model',
                    parts: [{ text: result?.text || "I apologize, I seem to have responded incorrectly." }]
                });
                history.push({
                    role: 'user',
                    parts: [{ text: "System note: That was an invalid response. You must respond with a tool call. Please re-evaluate the user's request and call the appropriate tool to continue the plan." }]
                });
                console.log(`[MasterWorker][${currentJobId}] Appended system note to history. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
            }
        }
    }

    if (!result) throw new Error("AI planner failed to respond after all retries.");

    console.log(`[MasterWorker][${currentJobId}] Raw response from Gemini planner:`, JSON.stringify(result, null, 2));

    if (!functionCalls || functionCalls.length === 0) {
        const usage = result?.usageMetadata;
        if (usage && usage.promptTokenCount > MAX_TOKEN_THRESHOLD) {
            const errorMessage = "This conversation has reached its maximum context memory. To continue, please start a new chat.";
            console.error(`[MasterWorker][${currentJobId}] Orchestrator failed due to token limit. Tokens: ${usage.promptTokenCount}.`);
            await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: errorMessage }).eq('id', currentJobId);
            return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
        }

        console.error(`[MasterWorker][${currentJobId}] Orchestrator did not return a tool call after all retries. Finishing task with an error message.`);
        await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: "The agent could not decide on a next step." }).eq('id', currentJobId);
        return new Response(JSON.stringify({ error: "Agent failed to decide on a next step." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
    }

    const call = functionCalls[0];
    console.log(`[MasterWorker][${currentJobId}] Gemini decided to call tool: ${call.name} with args:`, JSON.stringify(call.args, null, 2));
    history.push({ role: 'model', parts: [{ functionCall: call }] });
    
    let toolResponseData;
    const historyParts: Part[] = [];

    if (call.name === 'dispatch_to_brand_analyzer') {
        console.log(`[MasterWorker][${currentJobId}] Dispatching to brand analyzer...`);
        currentContext.brand_name = call.args.brand_name;
        await supabase.from('mira-agent-jobs').update({ context: currentContext }).eq('id', currentJobId);

        const { error } = await supabase.functions.invoke('MIRA-AGENT-executor-brand-analyzer', { body: { job_id: currentJobId } });
        if (error) throw error;

        return new Response(JSON.stringify({ success: true, message: "Brand analysis initiated." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (call.name === 'generate_image') {
        console.log(`[MasterWorker][${currentJobId}] Dispatching to text-to-image generator...`);
        let finalModelId = currentContext.selectedModelId;

        if (!finalModelId) {
            console.warn(`[MasterWorker][${currentJobId}] No model selected in job context. Fetching default model from database.`);
            const { data: defaultModel, error: modelError } = await supabase
                .from('mira-agent-models')
                .select('model_id_string')
                .eq('is_default', true)
                .limit(1)
                .single();
            
            if (modelError || !defaultModel) {
                console.error(`[MasterWorker][${currentJobId}] Failed to fetch default model:`, modelError);
                throw new Error("Cannot generate image: No model was selected and no default model could be found.");
            }
            
            finalModelId = defaultModel.model_id_string;
            console.log(`[MasterWorker][${currentJobId}] Using default model: ${finalModelId}`);
        }
        
        const { data: modelDetails } = await supabase.from('mira-agent-models').select('provider').eq('model_id_string', finalModelId).single();
        const provider = modelDetails?.provider.toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'google';
        
        let toolToInvoke = '';
        let payload: { [key: string]: any } = {
            prompt: call.args.prompt,
            negative_prompt: call.args.negative_prompt,
            seed: call.args.seed,
            model_id: finalModelId,
            invoker_user_id: job.user_id
        };

        if (currentContext.numImagesMode && currentContext.numImagesMode !== 'auto') {
            payload.number_of_images = currentContext.numImagesMode;
        } else if (call.args.number_of_images) {
            payload.number_of_images = call.args.number_of_images;
        }

        let sizeArg = '';
        if (currentContext.ratioMode && currentContext.ratioMode !== 'auto') {
            sizeArg = currentContext.ratioMode;
        } else if (call.args.size) {
            sizeArg = call.args.size;
        }

        if (provider === 'google') {
            toolToInvoke = 'MIRA-AGENT-tool-generate-image-google';
            payload.size = sizeArg;
        } else if (provider === 'fal.ai') {
            toolToInvoke = 'MIRA-AGENT-tool-generate-image-fal-seedream';
            payload.size = sizeArg;
        } else {
            throw new Error(`Unsupported provider '${provider}' for image generation in master worker.`);
        }

        console.log(`[MasterWorker][${currentJobId}] Invoking tool: ${toolToInvoke} for provider: ${provider} with sanitized payload:`, payload);
        const { data, error } = await supabase.functions.invoke(toolToInvoke, { body: payload });
        if (error) throw error;
        toolResponseData = data;
        historyParts.push({ functionResponse: { name: call.name, response: toolResponseData } });

    } else if (call.name === 'dispatch_to_refinement_agent') {
        console.log(`[MasterWorker][${currentJobId}] Dispatching to refinement agent...`);
        const { prompt, upscale_factor } = call.args;
        const { error } = await supabase.functions.invoke('MIRA-AGENT-executor-refinement', {
            body: {
                job_id: currentJobId,
                prompt,
                upscale_factor
            }
        });
        if (error) throw error;

        return new Response(JSON.stringify({ success: true, message: "Refinement job dispatched." }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (call.name === 'dispatch_to_artisan_engine' || call.name === 'critique_images') {
        const toolName = call.name === 'dispatch_to_artisan_engine' ? 'MIRA-AGENT-tool-generate-image-prompt' : 'MIRA-AGENT-tool-critique-images';
        
        const prunedHistory = getValidHistorySliceForTool(history, HISTORY_SLICE_FOR_TOOLS);

        const payload = { body: { history: prunedHistory, iteration_number: iterationNumber, is_designer_mode: currentContext.isDesignerMode } };
        console.log(`[MasterWorker][${currentJobId}] Invoking ${toolName} with pruned history (last ${prunedHistory.length} valid turns)...`);
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

        history.push({
            role: 'function',
            parts: [{
                functionResponse: {
                    name: 'present_image_choice',
                    response: finalResult
                }
            }]
        });

        currentContext.history = history;
        await supabase.from('mira-agent-jobs').update({
            status: 'awaiting_feedback',
            context: currentContext,
            final_result: null
        }).eq('id', currentJobId);

        console.log(`[MasterWorker][${currentJobId}] Job status set to 'awaiting_feedback' with an image choice proposal in history.`);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    } else if (call.name === 'finish_task') {
        const { response_type, summary, follow_up_message } = call.args;
        let finalResult: any = {};
        let finalStatus = 'complete';

        console.log(`[MasterWorker][${currentJobId}] Finish task called with type: ${response_type}.`);
        
        if (response_type === 'creative_process_complete') {
            const creativeResult = assembleCreativeProcessResult(history);
            if (creativeResult) {
                finalResult = creativeResult;
                if (summary) finalResult.text = summary;
                if (follow_up_message) finalResult.follow_up_message = follow_up_message;
            } else {
                finalResult.text = summary || "The process is complete, but I couldn't assemble the final report.";
            }
        } else {
            if (summary) finalResult.text = summary;
            if (follow_up_message) finalResult.follow_up_message = follow_up_message;
        }
        
        if (response_type === 'clarification_question') {
            finalStatus = 'awaiting_feedback';
        }

        history.push({
            role: 'function',
            parts: [{
                functionResponse: {
                    name: 'provide_text_response',
                    response: finalResult
                }
            }]
        });

        currentContext.history = history;
        currentContext.iteration_number = iterationNumber;
        await supabase.from('mira-agent-jobs').update({ status: finalStatus, final_result: null, context: currentContext }).eq('id', currentJobId);
        console.log(`[MasterWorker][${currentJobId}] Job status set to '${finalStatus}'. Job is complete.`);
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } else {
      throw new Error(`Master worker received unknown tool call: ${call.name}`);
    }
    
    history.push({ role: 'function', parts: historyParts });
    currentContext.history = history;
    currentContext.iteration_number = iterationNumber;
    await supabase.from('mira-agent-jobs').update({ context: currentContext, status: 'processing' }).eq('id', currentJobId);
    
    console.log(`[MasterWorker][${currentJobId}] Step complete. Invoking next step...`);
    supabase.functions.invoke('MIRA-AGENT-master-worker', { body: { job_id: currentJobId } });
    
    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error(`[MasterWorker] FATAL ERROR for job ${currentJobId}:`, error);
    if (currentJobId) await supabase.from('mira-agent-jobs').update({ status: 'failed', error_message: error.message }).eq('id', currentJobId);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});