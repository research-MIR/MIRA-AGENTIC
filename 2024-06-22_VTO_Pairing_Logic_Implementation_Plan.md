# VTO Pairing Logic - Implementation & To-Do List
**Date:** 2024-06-22
**Objective:** To document the foundational backend changes made to the pose analysis pipeline and to outline the precise frontend implementation plan for the new, intelligent VTO pairing logic.

---

## Part 1: Completed Foundational Work (The "How We Got Here")

To enable the sophisticated filtering required, we first had to enrich the data we collect about each generated pose. The core problem identified was that a simple semantic tag like `"is_underwear"` was insufficient and ambiguous. The solution was to switch to a direct visual comparison against a known baseline.

### ✅ 1.1. Upgraded the Pose Analyzer for Visual Comparison

The primary change was to make the pose analyzer stateful and comparative, rather than just descriptive.

-   **File Modified:** `supabase/functions/MIRA-AGENT-analyzer-pose-image/index.ts`
-   **The Goal:** To stop guessing what a garment is and instead determine if it's the *exact same garment* as the one on the original base model.
-   **Implementation Details:**
    1.  **New Inputs:** The function's signature was changed. It no longer accepts just a single pose image URL. It now requires:
        -   `pose_image_url`: The generated pose to be analyzed.
        -   `base_model_image_url`: The URL of the original, approved base model (wearing the neutral grey underwear).
    2.  **System Prompt Overhaul:** The system prompt for the Gemini model was completely rewritten.
        -   It is now explicitly given two images: a "BASE MODEL" and a "GENERATED POSE".
        -   A new critical instruction was added: **Task 3: Visual Comparison**. This instructs the AI to perform a strict, pixel-level comparison and determine if the garment in the pose is identical to the garment on the base model.
    3.  **New Output Field:** The function's JSON output schema was updated. The old `is_base_underwear` field was replaced with `is_identical_to_base_garment: boolean`. This provides an unambiguous, data-driven flag.
-   **Outcome:** This function now provides a highly reliable, boolean data point for every generated pose, which is the cornerstone of our new filtering logic.

### ✅ 1.2. Updated the Poller to Provide Necessary Context

The analyzer needs the base model's URL to do its job, so the process that calls the analyzer had to be updated.

-   **File Modified:** `supabase/functions/MIRA-AGENT-poller-model-generation/index.ts`
-   **The Goal:** To ensure that when a pose is ready for analysis, the poller provides the analyzer with all the required data.
-   **Implementation Details:**
    1.  **Contextual Awareness:** The poller's `handlePollingPosesState` function already has access to the full `job` record from the database.
    2.  **Modified Invocation:** The `supabase.functions.invoke('MIRA-AGENT-analyzer-pose-image', ...)` call was updated. It now passes a body containing not only the `image_url` of the pose to be analyzed but also the `base_model_image_url` from the parent job record.
-   **Outcome:** The data pipeline is now complete. The poller correctly triggers the enhanced analyzer with the necessary context for it to perform its visual comparison.

---

## Part 2: Implementation To-Do List (The "Where We're Going")

With the backend data foundation now solid, the following frontend tasks will implement the intelligent pairing logic.

### ☐ 2.1. Implement the Core Compatibility Logic

This is the brain of the new feature. A new function will be created to house all the pairing rules.

-   **File to Modify:** `src/components/VTO/VtoInputProvider.tsx`
-   **Action:** Create a new function `isPoseCompatible(garment: AnalyzedGarment, pose: Pose): boolean`.
-   **Function Logic (Pseudocode):**
    ```typescript
    function isPoseCompatible(garment, pose) {
      // --- Rule 1: Primary Framing Check ---
      const garmentFit = garment.analysis.type_of_fit;
      const shootFocus = pose.analysis.shoot_focus;

      if (garmentFit === 'upper_body' && !['upper_body', 'full_body'].includes(shootFocus)) return false;
      if (garmentFit === 'lower_body' && !['lower_body', 'full_body'].includes(shootFocus)) return false;
      if (garmentFit === 'full_body' && shootFocus !== 'full_body') return false;

      // --- Rule 2: Garment Conflict & Context Check ---
      const poseGarment = pose.analysis.garment;

      if (garmentFit === 'upper_body') {
        // Valid ONLY if the pose shows the base underwear OR just pants.
        // Invalid if the pose shows a different fashion top.
        return poseGarment.is_identical_to_base_garment === true || poseGarment.coverage === 'lower_body';
      }

      if (garmentFit === 'lower_body') {
        // Valid ONLY if the pose shows a REAL upper body garment.
        // Invalid if the pose is topless OR only has the base bra.
        return poseGarment.coverage === 'upper_body' && poseGarment.is_identical_to_base_garment === false;
      }

      if (garmentFit === 'full_body') {
        // Valid ONLY if the pose shows the base underwear.
        return poseGarment.is_identical_to_base_garment === true;
      }

      return true; // Default case
    }
    ```

### ☐ 2.2. Integrate Filtering into the UI

The user needs to see the results of this logic in real-time.

-   **File to Modify:** `src/components/VTO/ModelPoseSelector.tsx`
-   **Action:**
    1.  The component will accept a new prop: `garmentFilter: AnalyzedGarment | null`.
    2.  When `garmentFilter` is provided, the component will map over the `models` and their `poses`.
    3.  For each `pose`, it will call the new `isPoseCompatible(garmentFilter, pose)` function.
    4.  Poses that return `false` will be visually disabled (e.g., with a greyed-out effect and `pointer-events-none`) to give the user immediate feedback.

### ☐ 2.3. Update the Final Queue Generation Logic

The `handleProceed` function must use the new compatibility check to build the final list of jobs.

-   **File to Modify:** `src/components/VTO/VtoInputProvider.tsx`
-   **Action:**
    1.  Inside the `handleProceed` function, after the initial gender-matching is done, a new filtering step will be added.
    2.  The code will iterate through every potential `(garment, model)` pair.
    3.  For each pair, it will iterate through all of `model.poses`.
    4.  Each `pose` will be passed to `isPoseCompatible(garment, pose)`.
    5.  Only the poses that return `true` will be added to the final `queue` that is sent to the next step.

---

## Part 3: Verification & Testing Plan

Once the frontend implementation is complete, the following scenarios must be tested to ensure all rules are working as intended.

-   **[ ] Test Case 1 (Upper Body Garment):**
    -   Select a T-shirt (`upper_body`).
    -   **Expected:** The model selector should disable all poses with a `shoot_focus` of `'lower_body'`. It should also disable any poses where the model is already wearing a non-base fashion top (e.g., a jacket).

-   **[ ] Test Case 2 (Lower Body Garment):**
    -   Select a pair of pants (`lower_body`).
    -   **Expected:** The model selector should disable all poses with a `shoot_focus` of `'upper_body'`. Crucially, it must also disable any poses where the model is only wearing the base bra (`is_identical_to_base_garment: true`). It should ONLY enable poses where a "real" top is already present.

-   **[ ] Test Case 3 (Full Body Garment):**
    -   Select a dress (`full_body`).
    -   **Expected:** The model selector should disable all poses except those with a `shoot_focus` of `'full_body'` AND where the model is wearing the base underwear (`is_identical_to_base_garment: true`).

-   **[ ] Test Case 4 (Random Pairs Mode):**
    -   Select a mix of upper and lower body garments and a mix of models.
    -   **Expected:** The final generated queue in the "Review" step should be smaller than the total possible combinations, containing only pairs that have passed all compatibility checks.

---

### Conclusion

By completing the tasks in Part 2, we will have a highly intelligent, automated pairing system that prevents common VTO errors, streamlines the user's workflow, and produces a higher quality of output by default.