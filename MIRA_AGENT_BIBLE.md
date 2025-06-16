# The Mira Agent Bible: A Project History & Technical Deep Dive

This document serves as the single source of truth for the Mira Agent project. It is a detailed, illustrated history capturing key architectural decisions, features, and code implementations. It is intended for any developer who needs to understand the system's components, data flow, and setup requirements, from its inception to its current state.

---

## Part 1: Architecture Deep Dive

### 1. Core Philosophy: Asynchronous & Stateful

The agent is designed to handle complex, multi-step tasks that may take longer than a single serverless function's timeout limit. To achieve this, the entire architecture is built around an **asynchronous, job-based model**.

Instead of a single function trying to do everything at once, a central **Orchestrator** breaks down tasks into small steps. The state of each job (its history, current status, and results) is stored persistently in a Supabase database table. This makes the agent resilient, scalable, and capable of handling long-running, complex plans.

### 2. System Components

The architecture consists of several key components that work together:

| Component                     | Technology          | Purpose                                                                                             |
| ----------------------------- | ------------------- | --------------------------------------------------------------------------------------------------- |
| **Frontend**                  | React (Vite)        | The user interface for chatting with the agent, uploading files, and viewing results.               |
| **File Storage**              | Supabase Storage    | Dedicated buckets (`mira-agent-user-uploads`, `mira-generations`) to store all files.     |
| **Job Database**              | Supabase Postgres   | A single table (`mira-agent-jobs`) that acts as the "brain" or "state machine" for the entire system. |
| **Realtime Communication**    | Supabase Realtime   | Pushes live updates from the `mira-agent-jobs` table to the frontend for a seamless UX.              |
| **Orchestrator & Tools**      | Supabase Edge Funcs | A collection of Deno functions that contain the agent's logic, planning, and execution capabilities. |

### 3. The Agent Lifecycle: A Detailed Walkthrough

Understanding the data flow is key to understanding the system.

#### Scenario A: Generating a New Image Prompt

1.  **UI:** The user types "Create a prompt for a photorealistic cat" and uploads an image of a cat.
2.  **`handleSendMessage` (Frontend):** The image is uploaded to Supabase Storage. An API call is made to the `MIRA-AGENT-master-worker` with the text prompt and the storage path of the image.
3.  **`master-worker` (New Job):**
    -   It receives the prompt and file path.
    -   It downloads the image from the storage path, encodes it to Base64, and creates a multimodal `parts` array containing both the text and the image data.
    -   It creates a **new row** in the `mira-agent-jobs` table with the initial context.
    -   It immediately returns the new `jobId` to the frontend.
    -   Crucially, it **asynchronously invokes itself**, passing the new `jobId` to kickstart the plan.
4.  **UI:** The frontend receives the `jobId` and opens a **Realtime subscription** to that specific row in the `mira-agent-jobs` table. It displays a "Working on it..." card.
5.  **`master-worker` (Plan Execution):**
    -   It wakes up, loads the job from the database.
    -   It sends the history (containing the text and image) to the Gemini planner.
    -   The planner responds with a tool call: `dispatch_to_artisan_engine`.
    -   The `master-worker` code finds the last user message (with the image) and invokes the `MIRA-AGENT-tool-generate-image-prompt` function, passing the full multimodal context.
6.  **`ArtisanEngine` Tool:**
    -   Receives the text and image.
    -   Performs its own detailed `generateContent` call to Gemini using its specialized system prompt.
    -   Returns the structured JSON analysis and prompt.
7.  **`master-worker` (Finalizing):**
    -   It receives the result from the `ArtisanEngine`.
    -   It now knows the plan is complete. It calls the `finish_task` tool to wrap the result in a display-ready format.
    -   It performs a final `UPDATE` on the job row in the database, setting the `status` to `complete` and populating the `final_result` column.
8.  **Realtime -> UI:**
    -   The `UPDATE` to the database row triggers the Supabase Realtime service.
    -   The frontend, which has been listening, receives the complete job object.
    -   It sees `status: 'complete'` and replaces the "Working on it..." card with the final `ArtisanEngineResponse` component.

#### Scenario B: Refining a Prompt with Feedback

1.  **UI:** The user sees the `ArtisanEngineResponse` card. They type "Make it more cinematic" into the "Refine" input and click submit.
2.  **`handleRefine` (Frontend):** An API call is made to the **`MIRA-AGENT-continue-job`** function, passing the `jobId` and the new feedback text.
3.  **`continue-job` Function:**
    -   It loads the specified job from the database.
    -   It appends the new user feedback to the job's `context.history`.
    -   It updates the job row in the database.
    -   It invokes the `MIRA-AGENT-master-worker` to continue the plan.
4.  **The loop continues** from Step 5 in Scenario A, but this time the `master-worker`'s planner sees the full history, including the V1 prompt and the new feedback, allowing it to make a more informed decision.

### 4. Setup & Configuration

To run this project, the following setup is required.

#### 4.1. Database Schema

The `mira-agent-jobs` table is required. It can be created by running the following command in the Supabase SQL Editor:

```sql
CREATE TABLE public."mira-agent-jobs" (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending'::text,
  original_prompt text NULL,
  context jsonb NULL,
  final_result jsonb NULL,
  error_message text NULL,
  CONSTRAINT "mira-agent-jobs_pkey" PRIMARY KEY (id)
);

-- Add a trigger to automatically update the 'updated_at' timestamp
CREATE OR REPLACE FUNCTION public.handle_mira_agent_jobs_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_mira_agent_jobs_update
  BEFORE UPDATE ON public."mira-agent-jobs"
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_mira_agent_jobs_update();

-- Enable Row Level Security
ALTER TABLE public."mira-agent-jobs" ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read jobs for realtime to work
CREATE POLICY "Allow authenticated users to read jobs"
  ON public."mira-agent-jobs"
  FOR SELECT
  USING (true);

-- Allow service roles (backend functions) to do everything
CREATE POLICY "Allow service_role full access"
  ON public."mira-agent-jobs"
  FOR ALL
  USING (auth.role() = 'service_role');
```

#### 4.2. Storage Buckets & RLS

The project uses two storage buckets. Create them in the Supabase Dashboard with public access disabled.
- `mira-agent-user-uploads`
- `mira-generations`

Then, apply the following RLS policies using the SQL Editor:

```sql
-- Policies for mira-agent-user-uploads
CREATE POLICY "Authenticated users can upload files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'mira-agent-user-uploads');
CREATE POLICY "Service role can access all user uploads" ON storage.objects FOR SELECT USING (bucket_id = 'mira-agent-user-uploads' AND auth.role() = 'service_role');

-- Policies for mira-generations
DROP POLICY IF EXISTS "Authenticated users can view their own images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to their own folder" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete their own images" ON storage.objects;
DROP POLICY IF EXISTS "Service role has full access" ON storage.objects;

CREATE POLICY "Authenticated users can view their own images"
ON storage.objects FOR SELECT
USING ( bucket_id = 'mira-generations' AND (storage.foldername(name))[1] = auth.uid()::text );

CREATE POLICY "Authenticated users can upload to their own folder"
ON storage.objects FOR INSERT
WITH CHECK ( bucket_id = 'mira-generations' AND (storage.foldername(name))[1] = auth.uid()::text );

CREATE POLICY "Authenticated users can delete their own images"
ON storage.objects FOR DELETE
USING ( bucket_id = 'mira-generations' AND (storage.foldername(name))[1] = auth.uid()::text );

CREATE POLICY "Service role has full access"
ON storage.objects FOR ALL
USING ( auth.role() = 'service_role' );
```

#### 4.3. Realtime Configuration

The frontend relies on Realtime updates for a responsive user experience. The following tables must be added to the `supabase_realtime` publication:
-   `mira-agent-jobs` (for the main agent chat and direct generator)
-   `mira-agent-comfyui-jobs` (for tracking Refine & Upscale jobs)
-   `mira-agent-vto-pipeline-jobs` (for tracking Virtual Try-On jobs)

You can enable this in two ways:

**1. Via the Supabase Dashboard (Recommended):**
1.  Go to your Supabase Project Dashboard.
2.  Navigate to **Database** -> **Publications**.
3.  Click on the `supabase_realtime` publication.
4.  Add the tables listed above to this publication and ensure `INSERT`, `UPDATE`, and `DELETE` are toggled on for each.
5.  Save your changes.

**2. Via SQL:**
Alternatively, you can run the following command in the Supabase SQL Editor to ensure all necessary tables are included in the publication.

```sql
ALTER PUBLICATION supabase_realtime
ADD TABLE 
  public."mira-agent-jobs", 
  public."mira-agent-comfyui-jobs", 
  public."mira-agent-vto-pipeline-jobs";
```

#### 4.4. Environment Variables

The Edge Functions require secrets to be set in your Supabase project settings under **Settings** -> **Edge Functions**. The required variables include:
-   `SUPABASE_URL`
-   `SUPABASE_SERVICE_ROLE_KEY`
-   `GEMINI_API_KEY`
-   `GOOGLE_SEARCH_API` (for the search tool)
-   `GOOGLE_SEARCH_CX` (for the search tool)
-   `GOOGLE_VERTEX_AI_SA_KEY_JSON` (for the image generation tool)
-   `GOOGLE_PROJECT_ID` (for the image generation tool)

---

## Part 2: The Project History (Changelog)

### Chapter 1: The Genesis - A Monolithic Planner & The Multi-Step Challenge

-   **Objective:** Create a foundational agent capable of answering user questions by calling functions that query a database, including chaining multiple calls together to solve a complex query.
-   **Architectural Journey:** We began with a single, monolithic `MIRA-AGENT-planner` Edge Function responsible for the entire workflow.
-   **Key Challenge & Solution:** The agent initially struggled with multi-step reasoning. The breakthrough came when we heavily modified the **system prompt** for the planner, giving it an explicit, detailed example of a multi-step flow. This gave the model the "cognitive map" it needed to chain tools together.
-   **Pivotal Code:** The `getPlannerSystemPrompt` function with the detailed example.

### Chapter 2: The Great Refactor - Specialization with Executors

-   **Objective:** Evolve the architecture to be more robust, maintainable, and scalable by separating concerns.
-   **Architectural Journey:** We implemented the **Planner/Executor** model. The monolithic planner was broken down into a "brain" (the planner) and specialized "hands" and a "voice" (the executors).
-   **Pivotal Code:** We created `MIRA-AGENT-executor-database` to handle all DB calls and `MIRA-AGENT-executor-conversation` to synthesize final responses. The planner was upgraded to delegate tasks to these specialists.

### Chapter 3: The Multimodal Leap - A "Bible" of Trial and Error

-   **Objective:** Give the agent "senses" by enabling it to process user-uploaded files.
-   **Architectural Journey:** This was our most challenging phase. We hit several technical hurdles, including RLS policies, Base64 encoding errors, and API payload format issues. The most critical decision was an architectural pivot based on user insight: we made the **planner itself multimodal** instead of using a separate file analyzer. This allows the planner to see the full context (text + files) from the very beginning.
-   **Pivotal Code:** The `MIRA-AGENT-planner` was refactored to handle file processing via Base64 `inlineData` *before* its main reasoning loop.

### Chapter 4: The Artisan - A Hierarchical Sub-Planner

-   **Objective:** Implement a highly specialized "sub-agent" for the complex, creative task of prompt engineering.
-   **Architectural Journey:** We implemented a **hierarchical agent** architecture. The main planner acts as a CEO, delegating the entire creative task to the `ArtisanEngine`, which acts as a self-contained sub-planner.
-   **Pivotal Code:** We created the `MIRA-AGENT-tool-generate-image-prompt` as a stateful sub-planner. The main planner's role was simplified to just delegating to it.

### Chapter 5: Advanced UX & The Interactive Response

-   **Objective:** To significantly enhance the user experience for file handling and to display complex agent outputs in a more structured and professional manner.
-   **Architectural Journey & Key Decisions:**
    1.  **Advanced File Handling:** The frontend was overhauled to support multi-file uploads and a more intuitive attachment lifecycle.
    2.  **Structured JSON Output:** We refactored the `ArtisanEngine` to parse its own output and return a clean, structured JSON object.
    3.  **Interactive UI Component:** We created a new, dedicated React component, `ArtisanEngineResponse.tsx`, to render the structured JSON as a stylish, collapsible accordion.
-   **Pivotal Code Implementations:** The `ArtisanEngine`'s JSON parser, the `ArtisanEngineResponse.tsx` component, and the conditional rendering logic in `Index.tsx`.

### Chapter 6: The Brand Strategist - A Debugging Odyssey

-   **Objective:** To give Mira the ability to perform autonomous research and analysis on a brand's online identity.
-   **Architectural Journey & Key Decisions:**
    1.  **The Goal & The Pivot:** The initial goal was to analyze a brand's website. We pivoted from simple screenshots to analyzing the *actual images* on the site using Gemini's powerful built-in `urlContext` tool.
    2.  **The API Constraint Discovery:** We discovered a fundamental rule: a single API call cannot mix custom `functionDeclarations` (like our `google_search` tool) and the built-in `urlContext` tool.
    3.  **The Final Architecture (Return to Executors):** This constraint forced us back to the clean Planner/Executor model. The final, working solution involves the `MIRA-AGENT-planner` using `google_search` to get a URL, then dispatching the analysis task to a specialized `MIRA-AGENT-tool-analyze-url-content` function that uses *only* the `urlContext` tool.
-   **Pivotal Code:** The final, robust implementation of the planner and the web-browser executor, correctly separating their concerns to respect the API's limitations.

### Chapter 7: The Asynchronous Leap - A Resilient, Job-Based Agent

-   **Objective:** To enable complex, multi-step plans without running into server timeouts.
-   **The Challenge: The Timeout Wall:** Our previous hierarchical planner attempted to run its entire multi-step plan within a single, synchronous function call, leading to `504 Gateway Timeout` errors.
-   **The Architectural Solution: A Job-Based State Machine:** We pivoted to a professional and scalable **asynchronous architecture**. The database became the "memory" or "state machine" for the agent.
-   **Key Components of the New Architecture:**
    1.  **`mira-agent-jobs` Table:** A new database table to act as the central nervous system, tracking each job's `status` and `context`.
    2.  **The `MIRA-AGENT-master-worker`:** A powerful orchestrator that executes plans step-by-step, reading and writing to the job's `context` at each stage.
    3.  **Realtime UI Connection:** The frontend was upgraded to use **Supabase Realtime** to subscribe to job updates and display progress seamlessly.
-   **The Result:** The final system is now significantly more robust, scalable, and powerful, capable of handling long-running, complex, multimodal tasks without failure.

### Chapter 8: The Image Generation Tool & Final Polish

-   **Objective:** Give Mira the ability to generate images based on the prompts created by the `ArtisanEngine`.
-   **Architectural Journey & Key Decisions:**
    1.  **Storage & Security:** Created a new Supabase Storage bucket `mira-generations` to store the output images. We implemented strict Row Level Security (RLS) policies on this bucket to ensure users can only access their own generated images.
    2.  **Specialist Tool:** Created a new tool, `MIRA-AGENT-tool-generate-image`. This Edge Function is responsible for calling the Google Vertex AI Imagen 4 model.
    3.  **Robust Generation:** The tool is designed to be robust, handling API authentication, retries, and generating multiple image variations in parallel.
    4.  **Self-Analysis:** The tool performs a "self-analysis" step: after generating an image, it uses Gemini Vision to create a description of the image it just made. This description is returned to the master planner, giving it "memory" of the generated content for future feedback cycles.
-   **Debugging & Refinement:**
    1.  **Idempotent SQL:** We encountered and fixed an SQL error where the RLS policies were being created multiple times. The fix was to use `DROP POLICY IF EXISTS` before creating them, making the script idempotent and safe to re-run.
    2.  **UI Data Mismatch:** We fixed a critical UI bug where multi-step results were not being displayed correctly. This was due to a key mismatch between the backend (`artisan_engine_result`) and the frontend (`prompt_analysis`). We updated the frontend to use the correct key, making the UI more robust against variations in AI output.

### Chapter 9: The User Experience Polish - A Smart, Interactive Onboarding Tour

-   **Objective:** To improve new user onboarding and accelerate feature discovery across the application's different pages.
-   **Architectural Journey & Key Decisions:**
    1.  **The Navigation Challenge:** The primary challenge was creating a tour that could reliably navigate between different pages in our React single-page application. Initial attempts to programmatically control navigation from within the tour library (`driver.js`) proved brittle and susceptible to race conditions.
    2.  **The Final Architecture (User-Driven Navigation):** The breakthrough was a complete change in strategy. Instead of the tour trying to navigate, it now instructs the user to click the navigation links in the sidebar themselves. A separate React `useEffect` hook listens for changes to the URL (`location.pathname`). When it detects the user has successfully navigated to the correct page, it programmatically tells the tour to advance to the next step. This user-driven pattern proved to be far more robust.
    3.  **Stateful Onboarding:** To prevent the tour from running every time for existing users, we made it "smart." The tour component now checks a `has_completed_onboarding_tour` flag in the user's `profiles` table. This allows the tour to run automatically once for new users, while still being available for a manual restart via a new "Restart Onboarding" button in the sidebar.
-   **Pivotal Code:** The final implementation of the `OnboardingTour.tsx` component, which contains the two `useEffect` hooks for managing the tour's state and reacting to navigation. The `OnboardingTourContext` was also created to allow the sidebar button to trigger the tour from anywhere in the component tree. Finally, the `set_onboarding_tour_complete` Supabase function was created to persist the user's completion status.