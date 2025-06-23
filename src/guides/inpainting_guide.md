# Advanced Inpainting & Correction: A Guide to VTO Pro Mode

Welcome to the most powerful tool in your creative arsenal. **Pro Mode** transforms the Virtual Try-On feature from a simple clothes-swapping tool into a surgical inpainting and correction engine, giving you pixel-level control over your images.

This guide focuses exclusively on using Pro Mode for general-purpose image editing, such as changing hairstyles, adding textures, removing objects, or altering specific details.

---

### Getting Started: How to Access Pro Mode

1.  Navigate to the **Virtual Try-On** page from the main sidebar.
2.  In the top-right corner, find the switch labeled **"Pro Mode"** and turn it on. The interface will change to the Pro Mode workbench.

---

### The Pro Mode Workflow: A Step-by-Step Guide

The process is designed to be intuitive. Follow these steps to make precise edits to your images.

#### Step 1: Upload Your Source Image

This is your canvas. This is the image you want to edit.

-   **How:** You can either drag and drop an image into the large central area or click to open a file selector.
-   **Result:** Your image will appear in the main workbench area, ready for you to work on.

#### Step 2: Masking - Tell the AI *Where* to Work

This is the most important interactive step. You will "paint" a mask over the area of the image you want the AI to change. Everything outside the mask will remain untouched.

-   **How:**
    1.  Your cursor will become a brush. Simply click and drag over the parts of the image you want to replace or modify.
    2.  Use the **Mask Controls** at the bottom of the image to adjust your brush size for fine details or large areas.
    3.  If you make a mistake, click the "Reset Mask" button to start over.

#### Step 3: Providing Instructions - Tell the AI *What* to Do

Once you've masked an area, you need to tell the AI what to put there. You have two powerful ways to do this.

##### **Use Case A: Inpainting with a Text Prompt**

Use this when you want to generate something new from a description.

-   **How:**
    1.  In the **"2. Prompt"** section, make sure the **"Auto-Generate"** switch is **OFF**.
    2.  In the text box, describe **only what should appear inside the masked area**.
-   **CRITICAL TIP:** Do not describe the entire scene. Describe only the object or change you want to make, as if it exists in the lighting and context of the original image.
    -   **❌ Bad Prompt:** "A woman with long, flowing blonde hair." (This describes the whole subject).
    -   **✅ Good Prompt:** "Long, flowing, photorealistic blonde hair with natural highlights, reflecting the ambient light of the scene." (This describes only the element to be inpainted).

##### **Use Case B: Inpainting with a Reference Image**

Use this when you want to transfer a specific object, texture, or style from another image.

-   **How:**
    1.  In the **"1. Inputs"** section, upload an image into the **"Reference Image"** box. This could be a photo of a specific texture (like metal or wood), a different hairstyle, or an object you want to place.
    2.  In the **"2. Prompt"** section, it's highly recommended to leave **"Auto-Generate" ON**. The AI will analyze both your source and reference images to create the perfect technical prompt for blending them.
    3.  (Optional) If you want to guide the AI further, you can add a specific instruction in the "Prompt Appendix" box under the PRO Settings.

#### Step 4: Fine-Tune with PRO Settings

The **"3. PRO Settings"** accordion gives you advanced control over the generation.

-   **Number of Images:** Generate multiple variations at once to see different interpretations from the AI.
-   **High Resolution:** Creates a larger, more detailed final image.
-   **Denoise Strength:** This is your "creativity" slider.
    -   A **low value** (e.g., 0.5) will stick closely to the original image's shapes and lighting within the mask. Ideal for changing colors or textures.
    -   A **high value** (e.g., 0.9) gives the AI more freedom to change the shape and form of the object within the mask.
-   **Mask Expansion:** This is a powerful blending tool. It slightly expands and softens the edge of your mask, which helps to create a much more seamless and natural transition between the original image and the newly generated content. Increase this if you see hard edges in your results.

#### Step 5: Generate!

Click the **"Generate"** button. Your job will be sent to the queue, and you can track its progress in the "Active Jobs" tracker in the sidebar. The result will appear in the "Result" panel when it's ready.

---

### Best Practices & Pro-Tips

-   **Mask Generously:** It's often better to mask a slightly larger area than you think you need. This gives the AI more room to blend its creation into the original image.
-   **Start with High Denoise:** For significant changes (like adding a hat), start with a high Denoise value (0.85-1.0). For subtle changes (like changing fabric color), start lower (0.5-0.7).
-   **Iterate:** Your first result might not be perfect. Use it as a learning experience. Adjust your mask, prompt, or Denoise strength and try again.
-   **Use the "Recent Jobs" list:** Your completed jobs appear in the list at the bottom. You can click on them to review the results and the settings that were used.