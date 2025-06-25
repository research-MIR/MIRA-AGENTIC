# Guide: Virtual Try-On (Pro Mode) vs. Inpainting Page

This document clarifies the distinct purposes and underlying technologies of the two advanced image editing features in the MIRA application. It is crucial to understand their differences to use the correct tool for the job.

---

## 1. Virtual Try-On (Pro Mode)

-   **Location:** Found within the "Virtual Try-On" page, activated by the "Pro Mode" switch.
-   **Purpose:** **Specialized for Garment Inpainting.** This tool is highly optimized for replacing or modifying clothing and accessories on a person.
-   **Underlying Technology:** Uses the **`MIRA-AGENT-proxy-bitstudio`** function with `mode: 'inpaint'`. This backend is specifically trained and fine-tuned for high-fidelity virtual try-on tasks, understanding the nuances of fabric, fit, and how clothing drapes on a human body.
-   **When to Use:**
    -   Replacing a shirt on a model.
    -   Changing the color or texture of a pair of pants.
    -   Adding a jacket over an existing outfit.
    -   Any task that involves editing **clothing**.

---

## 2. Inpainting Page

-   **Location:** A dedicated, top-level page in the main sidebar labeled "Inpainting".
-   **Purpose:** **General-Purpose, High-Flexibility Inpainting.** This is the tool for all other creative editing tasks that do not involve clothing.
-   **Underlying Technology:** Uses the **`MIRA-AGENT-proxy-comfyui`** function. This backend provides maximum creative freedom by leveraging a powerful, node-based workflow engine (ComfyUI). It is not specialized for garments but excels at a wide range of other modifications.
-   **When to Use:**
    -   Changing a person's hairstyle or facial features.
    -   Altering the background of a scene.
    -   Adding or removing objects (e.g., adding a coffee cup to a table).
    -   Applying artistic effects or textures to non-garment areas.
    -   Any complex photo manipulation that requires precise, pixel-level control over non-clothing elements.

---

### Key Takeaway

| Feature                  | Purpose                               | Backend Function                  | Best For...                                       |
| ------------------------ | ------------------------------------- | --------------------------------- | ------------------------------------------------- |
| **Virtual Try-On (Pro)** | Specialized Garment Editing         | `MIRA-AGENT-proxy-bitstudio`      | Clothing, accessories, virtual try-on.            |
| **Inpainting Page**      | General-Purpose Creative Editing    | `MIRA-AGENT-proxy-comfyui`        | Faces, hair, backgrounds, objects, textures.      |

**Do not attempt to unify these tools.** They are intentionally separate and use different, specialized backends to achieve the best possible results for their respective tasks.