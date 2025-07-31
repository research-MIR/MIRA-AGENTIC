# Mira Agent: A Detailed Architectural Analysis

This document provides a deep, block-by-block analysis of the Mira Agent's architecture and workflow, from frontend interaction to backend processing and final output.

---

### Block 1: The Frontend - Request Initiation & Media Handling

This block covers everything that happens in the user's browser. It's the user-facing part of the system, designed for intuitive interaction.

*   **Core Components:** The user interface is built in **React** with **TypeScript**. The main interaction happens within the `ChatInterface.tsx` component, which orchestrates several key sub-components:
    *   `ControlPanel.tsx`: Allows the user to select the AI model and toggle modes like "Designer Mode". These settings are crucial as they are passed with every request and dictate the agent's behavior.
    *   `PromptInput.tsx`: The text area for user prompts and the attachment button for uploading files.
    *   `MessageList.tsx`: Renders the entire conversation history, including text, images, and the specialized interactive cards for AI tool outputs.

*   **Media Upload & Processing:** When a user drags-and-drops a file or uses the upload button, a sophisticated process begins, managed by the `useFileUpload.ts` hook:
    1.  **File Type Handling:** The hook first checks the file type. It accepts standard images but also handles **PDFs**. If a PDF is detected, it uses the `pdfjs-dist` library to render each page into a high-quality image, effectively converting the document into a series of images the AI can see.
    2.  **Optimization:** Before uploading, every image is passed through an `optimizeImage` utility function. This function resizes the image to a maximum dimension (e.g., 1440px) and converts it to a web-friendly format. This step is critical for reducing upload times and processing costs.
    3.  **Supabase Storage:** The optimized file is then uploaded to a dedicated, secure bucket in **Supabase Storage** called `mira-agent-user-uploads`. This bucket has strict Row Level Security (RLS) policies ensuring users can only upload to their own sandboxed folder.
    4.  **State Management:** The hook updates the UI state, showing a preview of the uploaded file(s) next to the prompt input area. It holds onto the `storagePath` of the uploaded file.

*   **Sending the Request:** When the user clicks "Send", the `useChatManager.ts` hook takes over:
    1.  **Payload Assembly:** It gathers the text from the prompt input, the list of `storagePaths` from any uploaded files, and the settings from the `ControlPanel`.
    2.  **API Invocation:** It makes an API call to a specific Supabase Edge Function:
        *   If it's a new conversation, it calls **`MIRA-AGENT-create-job`**.
        *   If continuing an existing chat, it calls **`MIRA-AGENT-continue-job`**.

---

### Block 2: Job Ingestion & Asynchronous Kick-off

This block handles the creation and initialization of a new agent task in the backend.

*   **Entry Point:** The **`MIRA-AGENT-create-job`** Edge Function.
*   **Database Interaction:** Its first and most important job is to create a new row in the **`mira-agent-jobs`** table. This table is the "brain" and single source of truth for the entire system.
*   **Data Manipulation & Asset Preparation:**
    1.  The function receives the list of `storagePaths`.
    2.  It uses its privileged service role to download the files from Supabase Storage.
    3.  It converts each file into a **Base64 string** and packages it into a multimodal `parts` array, which is the format Gemini requires to understand both text and images in a single message.
    4.  It constructs the initial `context` object for the job, saving the UI settings and the initial user message (with Base64 images) into the `context.history`.
*   **Asynchronous Invocation (The "Kick-off"):** This is a critical architectural pattern. Instead of doing all the work at once, the function does two things asynchronously:
    1.  **Fire-and-Forget Title Generation:** It invokes **`MIRA-AGENT-tool-generate-chat-title`** in the background. This tool uses a fast AI model to read the first message and generate a concise title (e.g., "Knight in a Dark Forest"), which it then writes back to the `original_prompt` column of the job. This makes the chat history in the UI much cleaner.
    2.  **Start the Main Worker:** It invokes the main orchestrator, **`MIRA-AGENT-master-worker`**, passing it the `job_id` of the row it just created.
*   **Immediate Response:** The function immediately returns the `jobId` to the frontend, which then uses it to subscribe to Realtime updates for that specific job.

---

### Block 3: The Orchestrator - The `master-worker`

This is the core of the agent's intelligence. It's a stateful, resilient function that executes the plan.

*   **State Machine Logic:** The `master-worker` is designed as a state machine. It's invoked with a `job_id`, reads the entire job's state (especially the `context.history`) from the database, decides on the next action, and then re-invokes itself to continue the process.
*   **Planning Phase:**
    1.  **Dynamic System Prompt:** It first constructs a `systemPrompt` for the AI planner. This prompt is dynamic; it changes based on whether "Designer Mode" is enabled, instructing the AI to be either a proactive "Art Director" or a collaborative "Assistant".
    2.  **Dynamic Tool Selection:** It calls `getDynamicMasterTools` to build the list of functions the AI is allowed to use. This is also dynamic; for example, the `generate_image_with_reference` tool is only made available if the user has actually uploaded an image.
    3.  **LLM Call:** It sends the full conversation `history`, the dynamic `systemPrompt`, and the list of available `tools` to the **Gemini Pro** model. The model's job is not to answer the user, but to return a `functionCall` telling the orchestrator which tool to use next.
*   **Execution Phase:**
    1.  The `master-worker` receives the `functionCall` (e.g., `dispatch_to_artisan_engine`).
    2.  It uses a `switch` statement to route the request to the correct specialized tool, invoking another Edge Function (e.g., `MIRA-AGENT-tool-generate-image-prompt`).
*   **State Update & Loop:**
    1.  When the tool function returns its result (e.g., the detailed prompt from the Artisan Engine), the `master-worker` appends both the model's `functionCall` and the tool's `functionResponse` to the `context.history`.
    2.  It saves this updated history back to the `mira-agent-jobs` table.
    3.  It invokes itself again with the same `job_id`, allowing the planner to see the result of the last step and decide what to do next. This loop continues until the planner decides the task is complete and calls the `finish_task` tool.

---

### Block 4: Specialized Tools & Executors

These are the "hands" of the orchestrator, each designed to do one thing perfectly.

*   **`MIRA-AGENT-tool-generate-image-prompt` (The Artisan):** A "sub-agent" dedicated to creative writing. It receives the user's brief and images, analyzes them with its own specialized system prompt, and returns a highly detailed, structured JSON object containing a photorealistic prompt, an analysis, and a rationale.
*   **`MIRA-AGENT-tool-generate-image-google` / `...-fal-seedream`:** These are the image generators. They take a final text prompt, call the appropriate external API (Google Imagen or Fal.ai), and handle the image generation.
    *   **Self-Analysis:** After generating an image, they perform a crucial "self-analysis" step. They send the generated image back to Gemini Vision to get a concise text description of what was created. This description is returned with the image URL, giving the main planner "eyes" to understand the content of the images for subsequent refinement requests.
    *   **Storage:** The final images are saved to the `mira-generations` bucket, which has very strict RLS policies ensuring users can only access their own generated content.
*   **`MIRA-AGENT-tool-critique-images` (The Art Director):** Used only in "Designer Mode". It receives the generated images and the original brief, critiques them, and returns a JSON object with `is_good_enough: boolean`. If `false`, the `master-worker` loops back to the Artisan to refine the prompt.
*   **`MIRA-AGENT-executor-database`:** A simple router that maps tool names to specific SQL RPC functions in the Supabase database, allowing the agent to query for information like opening hours or customer details.

---

### Block 5: State Persistence & Realtime UI Updates

This block ensures the user experience is seamless and the system is resilient.

*   **Central Table:** The **`mira-agent-jobs`** table is the single source of truth for all agent activity.
*   **`updated_at` Trigger:** A database trigger automatically updates the `updated_at` timestamp on every change to a job row.
*   **Realtime Communication:** The frontend doesn't poll for updates. When a chat is open, it uses **Supabase Realtime** to subscribe to changes on its specific `jobId` row in the `mira-agent-jobs` table. Any `UPDATE` to that row by the `master-worker` is instantly pushed to the UI.
*   **UI Rendering:** When a Realtime update is received, the frontend re-parses the `history` and re-renders the `MessageList`, showing the latest state of the conversation.

---

### Block 6: The Watchdog - System Resilience

This block ensures that no job gets stuck in a processing state indefinitely.

*   **Purpose:** To ensure resilience and prevent jobs from getting stuck due to transient errors or timeouts.
*   **Mechanism:** The **`MIRA-AGENT-watchdog`** is a **Cron Job** that runs periodically (e.g., every minute).
*   **Logic:** It queries the `mira-agent-jobs` table for any job where `status` is `'processing'` but the `updated_at` timestamp is older than a defined threshold (e.g., 1 minute).
*   **Action:** For any "stalled" jobs it finds, it re-invokes the `MIRA-AGENT-master-worker` with the `job_id`, effectively "nudging" the process back to life. This ensures that even if a single function invocation fails silently, the system will automatically recover.