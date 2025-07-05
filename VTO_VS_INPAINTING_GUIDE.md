# Guide: Virtual Try-On (Pro Mode) vs. Inpainting Page

This document clarifies the distinct purposes and underlying technologies of the two advanced image editing features in the MIRA application. It is crucial to understand their differences to use the correct tool for the job.

---

## 1. Virtual Try-On (Pro Mode)

-   **Location:** Found within the "Virtual Try-On" page, activated by the "Pro Mode" switch.
-   **Purpose:** **Specialized for Garment Inpainting.** This tool is highly optimized for replacing or modifying clothing and accessories on a person.
-   **Underlying Technology:** This is a complex, multi-step workflow that uses **Gemini** for automatic mask generation and **BitStudio's Inpainting API** for the final image generation.
-   **Key Functions:**
    -   `MIRA-AGENT-proxy-batch-inpaint`: The entry point that queues up pairs of person/garment images.
    -   `MIRA-AGENT-watchdog-background-jobs`: A general watchdog that finds pending jobs and starts the process.
    -   `MIRA-AGENT-worker-batch-inpaint`: The first worker, which downloads images and starts the segmentation process.
    -   `MIRA-AGENT-orchestrator-segmentation`: Kicks off multiple parallel workers to analyze the image and create a mask.
    -   `MIRA-AGENT-worker-segmentation`: An individual worker that uses Gemini to generate a piece of the segmentation mask.
    -   `MIRA-AGENT-compositor-segmentation`: Stitches all the mask pieces together into a single, final mask.
    -   `MIRA-AGENT-worker-batch-inpaint-step2`: The final worker, which takes the completed mask and all other assets to prepare for the final inpainting call.
    -   `MIRA-AGENT-proxy-bitstudio` (in `inpaint` mode): The same proxy as the normal VTO, but in this mode, it sends the source image, the *generated mask*, and the reference garment to BitStudio's inpainting endpoint.
    -   `MIRA-AGENT-poller-bitstudio`: The same poller as the normal VTO. It takes over to check the status of the inpainting job on BitStudio's servers and retrieve the final image.

---

## 2. Inpainting Page

-   **Location:** A dedicated, top-level page in the main sidebar labeled "Inpainting".
-   **Purpose:** **General-Purpose, High-Flexibility Inpainting.** This is the tool for all other creative editing tasks that do not involve clothing. It requires the user to manually draw the mask.
-   **Underlying Technology:** Uses a self-hosted **ComfyUI** instance, which provides maximum creative freedom through a powerful, node-based workflow engine.
-   **Key Functions:**
    -   `MIRA-AGENT-proxy-inpainting`: The entry point for this page. It takes the source image, the user-drawn mask, and the prompt, then sends them to the ComfyUI backend.
    -   `MIRA-AGENT-poller-inpainting`: A dedicated poller that checks the status of the ComfyUI job.
    -   `MIRA-AGENT-compositor-inpainting`: A crucial final step that takes the small, inpainted patch returned by ComfyUI and seamlessly stitches it back into the original full-size image.

---

### Summary Table

| Feature                  | Purpose                               | Backend Technology | Key Functions |
| ------------------------ | ------------------------------------- | ------------------ | ------------- |
| **Virtual Try-On (Pro)** | Specialized Garment Editing         | Gemini + BitStudio | The entire `batch-inpaint` & `segmentation` chain. |
| **Inpainting Page**      | General-Purpose Creative Editing    | ComfyUI            | `proxy-inpainting`, `poller-inpainting`, `compositor-inpainting`. |

**Do not attempt to unify these tools.** They are intentionally separate and use different, specialized backends to achieve the best possible results for their respective tasks.