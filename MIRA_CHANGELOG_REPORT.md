# Project Update & Feature Report

This document details the significant new features and architectural changes recently implemented in the MIRA application. The primary focus has been on introducing advanced image manipulation capabilities and refining the user experience.

---

## 1. The ComfyUI Engine: Advanced Image Refinement & Upscaling

We have integrated a powerful, node-based image processing backend called **ComfyUI**. This is a significant architectural enhancement that moves beyond standard text-to-image generation.

*   **What it is:** ComfyUI allows us to build and execute highly complex, custom image processing workflows. Instead of a single model call, it can chain multiple operations together (e.g., load an image, apply a control model, upscale, refine details).

*   **Why it was added:** This backend is the engine that powers our new "Refine & Upscale" capabilities. It gives us the flexibility to offer sophisticated features that aren't possible with a single API call to a standard image model.

*   **How it works:** We've implemented a robust, asynchronous system to handle these potentially long-running jobs:
    1.  When a user starts a refinement job, the request is sent to our `MIRA-AGENT-proxy-comfyui` function.
    2.  This function queues the job in ComfyUI and records it in a new database table: `mira-agent-comfyui-jobs`.
    3.  A separate `MIRA-AGENT-poller-comfyui` function then periodically checks the ComfyUI server for the result.
    4.  Once the image is complete, the poller downloads it, saves it to our Supabase Storage, and updates the job's status in our database. The user is then notified that their job is complete.

---

## 2. New "Refine & Upscale" Page

To expose the power of the new ComfyUI engine, a dedicated **"Refine & Upscale"** page has been added to the application (accessible from the sidebar).

*   **Purpose:** This page provides a focused interface for improving and enlarging existing images. Users can upload an image they previously generated with MIRA or any other image from their computer.

*   **Key Features:**
    *   **Source Image Upload:** A simple interface to select the image you want to work on.
    *   **Refinement Prompt:** A text area where you can describe the desired changes (e.g., "make the lighting more dramatic," "change the style to be more like a watercolor painting").
    *   **Upscale Factor:** A slider to control the degree of upscaling, with a live preview of the resulting dimensions.
    *   **Before & After Comparison:** Once a job is complete, a powerful comparison tool allows you to slide between the original and refined images to see the changes clearly.
    *   **Asynchronous Job Tracking:** Refinement jobs run in the background. You can track their progress via the "Active Jobs Tracker" in the sidebar and will be notified upon completion.

---

## 3. Model & Workflow Simplification

To streamline the user experience and focus on the highest-quality outputs, we've made some important changes to the available models and workflows.

*   **Model Curation (OpenAI Model Removed):** We have removed the OpenAI model from the model selector. The project is now standardized on using Google's `Imagen` models for high-fidelity base generation and the new ComfyUI/Fal.ai backend for advanced creative tasks and refinement. This simplifies the user's choice and better aligns with our new, more powerful capabilities.

*   **Two-Stage Workflow Change:** The "Two-Stage Pipeline" switch has been removed from the main Agent Chat page. This was a deliberate design decision to improve user control and results. The powerful two-stage process (generation -> refinement) is now a **manual, user-driven workflow**:
    1.  **Stage 1 (Create):** Generate a base image using the "Agent Chat" or "Generator" page.
    2.  **Stage 2 (Refine):** Take your favorite result from Stage 1 to the new "Refine & Upscale" page to apply specific, intentional improvements.

    This separation gives you more control over the final output, as you can tailor the refinement prompt specifically to the generated image, which is more effective than an automated two-step process.

---

## 4. Enhanced Gallery with Source Filtering

The **Gallery** has been upgraded to help you better organize and understand your creations.

*   **New Filter Tabs:** The gallery now features tabs to filter your images by their creation source:
    *   **All:** Shows every image you've created.
    *   **Agent:** Images generated through a conversation on the main "Agent Chat" page.
    *   **Direct:** Images created using the "Generator" page.
    *   **Refined:** Images that have been processed through the "Refine & Upscale" page.

*   **Why it was added:** As the application grows with more ways to create images, these filters provide essential context and make it easier to find specific results based on how they were made.