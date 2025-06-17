# Advanced Image Segmentation with Gemini and the Canvas API

This guide provides a comprehensive walkthrough of how to achieve precise, pixel-level image segmentation using the Gemini API and how to correctly process and display the resulting masks on a frontend application using the HTML Canvas API. This moves beyond simple bounding boxes to create accurate, interactive overlays.

---

### 1. The Goal: What We're Building

Our objective is to take a source image and, based on a prompt, generate a semi-transparent overlay that perfectly highlights a specific object within that image.

**End Result:**

*(An image with a perfectly fitted red overlay on the subject)*

---

### 2. The Gemini API Call: Getting the Mask

To get a pixel-level mask, we need to configure our Gemini API call to request it. The most reliable method is to combine a clear, natural language instruction in the system prompt with the `responseMimeType: "application/json"` setting.

#### 2.1. The System Prompt (Updated & Simplified)

The system prompt must instruct the AI to return a single, combined mask for the object of interest. Instead of providing a full JSON example, we give a clear instruction on the desired output format.

```javascript
const systemPrompt = `You are a virtual stylist and expert image analyst...

[...All the critical rules about what to segment remain here...]

### Example Output:
Output a JSON segmentation mask where each entry contains the 2D
bounding box in the key "box_2d", the segmentation mask in key "mask", and
the text label in the key "label". Use descriptive labels.`;
```

#### 2.2. The API Call Structure (Updated)

The key is to use `responseMimeType: "application/json"` **without** a `responseSchema`. The combination of the MIME type hint and the clear instruction in the system prompt is sufficient and more reliable.

```typescript
import { GoogleGenAI, Part } from '@google/genai';

// Make the API call
const ai = new GoogleGenAI({ apiKey: 'YOUR_API_KEY' });
const result = await ai.models.generateContent({
    model: "gemini-2.5-pro-preview-06-05",
    contents: [{ role: 'user', parts: [/* your image part here */] }],
    generationConfig: {
        responseMimeType: "application/json",
        // NO responseSchema is needed here.
    },
    config: {
        systemInstruction: { role: "system", parts: [{ text: systemPrompt }] }
    }
});
```

#### 2.3. Key Lesson Learned

Previous versions of this function used a rigid `responseSchema` and a full JSON object in the "Example Output" section of the prompt. This proved to be brittle. The model would sometimes fail to generate a response, likely because it was struggling to perfectly match the complex example structure.

**The new, more robust approach is to:**
1.  Tell the model what to do in plain English within the prompt.
2.  Set `responseMimeType: "application/json"` to hint at the desired output container.
3.  **Do not** provide a `responseSchema` or a full JSON example in the prompt, as this can be counter-productive.

---

### 3. The Frontend Challenge: Why We Need the Canvas API

The Gemini API returns two crucial pieces of information:
1.  `box_2d`: A bounding box `[y_min, x_min, y_max, x_max]` with coordinates normalized to a 1000x1000 space.
2.  `mask`: A small, base64-encoded PNG image containing only the white mask shape on a black background.

We cannot simply display this mask image on top of our original image. It's the wrong size and in the wrong position. We must use the Canvas API to:
1.  **Scale** the mask to the correct dimensions.
2.  **Position** the mask precisely over the subject in the original image.
3.  **Colorize** the mask and make it semi-transparent to create the overlay effect.

---

### 4. Step-by-Step Implementation

Here's how to process the API response and render the overlay on the frontend.

#### Step 4.1: Setup a React Component

Create a component that will manage the state of the original image and the final, processed overlay.

```tsx
import { useState, useEffect } from 'react';

interface MaskData {
  box_2d: [number, number, number, number];
  label: string;
  mask: string; // The base64 string
}

interface YourComponentProps {
  originalImageUrl: string;
  maskData: MaskData | null;
}

const SegmentationOverlay = ({ originalImageUrl, maskData }: YourComponentProps) => {
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  // ... processing logic will go here
  
  return (
    <div className="relative">
      <img src={originalImageUrl} alt="Original" className="w-full h-auto" />
      {overlayUrl && (
        <img 
          src={overlayUrl} 
          alt="Segmentation Mask" 
          className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
        />
      )}
    </div>
  );
};
```

#### Step 4.2: Process the Mask Data with `useEffect`

This is the core logic. We use a `useEffect` hook that runs whenever the `maskData` or `originalImageUrl` changes.

```tsx
// Inside your component...
useEffect(() => {
  if (!maskData || !originalImageUrl) return;

  const originalImage = new Image();
  originalImage.crossOrigin = "anonymous";
  originalImage.src = originalImageUrl;

  originalImage.onload = () => {
    // A. Create an Image object from the base64 mask data
    const maskImage = new Image();
    maskImage.src = `data:image/png;base64,${maskData.mask}`;
    
    maskImage.onload = () => {
      const { width: originalW, height: originalH } = originalImage;
      const [y0, x0, y1, x1] = maskData.box_2d;

      // B. Calculate absolute pixel dimensions from normalized coordinates
      const absX0 = Math.floor((x0 / 1000) * originalW);
      const absY0 = Math.floor((y0 / 1000) * originalH);
      const bboxWidth = Math.ceil(((x1 - x0) / 1000) * originalW);
      const bboxHeight = Math.ceil(((y1 - y0) / 1000) * originalH);

      if (bboxWidth < 1 || bboxHeight < 1) return;

      // C. Resize the mask to the exact bounding box dimensions
      const resizedMaskCanvas = document.createElement('canvas');
      resizedMaskCanvas.width = bboxWidth;
      resizedMaskCanvas.height = bboxHeight;
      const resizedCtx = resizedMaskCanvas.getContext('2d')!;
      resizedCtx.drawImage(maskImage, 0, 0, bboxWidth, bboxHeight);

      // D. Create the final, full-size canvas
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = originalW;
      fullCanvas.height = originalH;
      const fullCtx = fullCanvas.getContext('2d')!;

      // E. Position the resized mask on the full-size canvas
      fullCtx.drawImage(resizedMaskCanvas, absX0, absY0);

      // F. Colorize the mask and make the background transparent
      const imageData = fullCtx.getImageData(0, 0, originalW, originalH);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const isMaskPixel = data[i] > 127; // Check the red channel
        if (isMaskPixel) {
          data[i] = 255;     // R
          data[i + 1] = 0;   // G
          data[i + 2] = 0;   // B
          data[i + 3] = 150; // Alpha (semi-transparent)
        } else {
          data[i + 3] = 0;   // Make non-mask pixels fully transparent
        }
      }
      fullCtx.putImageData(imageData, 0, 0);

      // G. Set the final data URL to be rendered
      setOverlayUrl(fullCanvas.toDataURL());
    };
  };
}, [originalImageUrl, maskData]);
```

---

### 5. Complete Code Example

Here is a full, self-contained component that you can use in your project.

```tsx
import React, { useState, useEffect } from 'react';

interface MaskData {
  box_2d: [number, number, number, number];
  label: string;
  mask: string; // The base64 string
}

interface SegmentationOverlayProps {
  originalImageUrl: string;
  maskData: MaskData | null;
}

export const SegmentationOverlay = ({ originalImageUrl, maskData }: SegmentationOverlayProps) => {
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!maskData || !originalImageUrl) {
      setOverlayUrl(null);
      return;
    }

    setIsLoading(true);
    const originalImage = new Image();
    originalImage.crossOrigin = "anonymous";
    originalImage.src = originalImageUrl;

    originalImage.onload = () => {
      const maskImage = new Image();
      maskImage.src = `data:image/png;base64,${maskData.mask}`;
      
      maskImage.onload = () => {
        try {
          const { width: originalW, height: originalH } = originalImage;
          const [y0, x0, y1, x1] = maskData.box_2d;

          const absX0 = Math.floor((x0 / 1000) * originalW);
          const absY0 = Math.floor((y0 / 1000) * originalH);
          const bboxWidth = Math.ceil(((x1 - x0) / 1000) * originalW);
          const bboxHeight = Math.ceil(((y1 - y0) / 1000) * originalH);

          if (bboxWidth < 1 || bboxHeight < 1) {
            console.error("Invalid bounding box dimensions.");
            setIsLoading(false);
            return;
          }

          const resizedMaskCanvas = document.createElement('canvas');
          resizedMaskCanvas.width = bboxWidth;
          resizedMaskCanvas.height = bboxHeight;
          const resizedCtx = resizedMaskCanvas.getContext('2d');
          if (!resizedCtx) throw new Error("Could not get 2D context for resized mask.");
          resizedCtx.drawImage(maskImage, 0, 0, bboxWidth, bboxHeight);

          const fullCanvas = document.createElement('canvas');
          fullCanvas.width = originalW;
          fullCanvas.height = originalH;
          const fullCtx = fullCanvas.getContext('2d');
          if (!fullCtx) throw new Error("Could not get 2D context for full canvas.");

          fullCtx.drawImage(resizedMaskCanvas, absX0, absY0);

          const imageData = fullCtx.getImageData(0, 0, originalW, originalH);
          const data = imageData.data;
          for (let i = 0; i < data.length; i += 4) {
            const isMaskPixel = data[i] > 127;
            if (isMaskPixel) {
              data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 150;
            } else {
              data[i + 3] = 0;
            }
          }
          fullCtx.putImageData(imageData, 0, 0);

          setOverlayUrl(fullCanvas.toDataURL());
        } catch (error) {
          console.error("Error processing segmentation mask:", error);
        } finally {
          setIsLoading(false);
        }
      };
      maskImage.onerror = () => {
        console.error("Failed to load mask image from base64 data.");
        setIsLoading(false);
      }
    };
    originalImage.onerror = () => {
      console.error("Failed to load original image.");
      setIsLoading(false);
    }
  }, [originalImageUrl, maskData]);

  return (
    <div className="relative inline-block">
      <img src={originalImageUrl} alt="Original" className="w-full h-auto" />
      {isLoading && <div className="absolute inset-0 bg-black/20 flex items-center justify-center">Loading Mask...</div>}
      {overlayUrl && (
        <img 
          src={overlayUrl} 
          alt="Segmentation Mask" 
          className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
        />
      )}
    </div>
  );
};
```

---

### Conclusion

By combining Gemini's powerful segmentation capabilities with the flexibility of the frontend Canvas API, you can create sophisticated and precise visual tools. The key is to correctly interpret the normalized bounding box data to scale and position the raw mask data onto a canvas that matches your original image's dimensions.