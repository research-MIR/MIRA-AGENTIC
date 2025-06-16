import { useEffect, useState } from 'react';

interface SegmentationMaskProps {
  maskData: string; // Base64 encoded PNG string
  box2d: [number, number, number, number]; // [y_min, x_min, y_max, x_max] normalized to 1000
  width: number; // width of the container image
  height: number; // height of the container image
}

// This function attempts to clean up the python bytes literal string `b'...'`
// into a raw string that can be base64 decoded.
const cleanupPythonBytesString = (raw: string): string => {
    if (raw.startsWith("b'") && raw.endsWith("'")) {
        const inner = raw.slice(2, -1);
        // This is a simplified parser and may not handle all edge cases,
        // but it should work for the common escapes found in the PNG data.
        return inner
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\\/g, '\\');
    }
    return raw;
}

export const SegmentationMask = ({ maskData, box2d, width, height }: SegmentationMaskProps) => {
  const [maskUrl, setMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!maskData || !box2d || !width || !height) return;

    try {
      const [yMin, xMin, yMax, xMax] = box2d;

      // 1. Calculate absolute coordinates for the bounding box
      const absX = (xMin / 1000) * width;
      const absY = (yMin / 1000) * height;
      const boxWidth = ((xMax - xMin) / 1000) * width;
      const boxHeight = ((yMax - yMin) / 1000) * height;

      if (boxWidth <= 0 || boxHeight <= 0) return;

      // 2. Create an image from the mask data
      const maskImage = new Image();
      maskImage.onload = () => {
        // 3. Create a canvas to draw the final, positioned and colored mask
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 4. Create a temporary canvas to colorize the mask
        const tempMaskCanvas = document.createElement('canvas');
        tempMaskCanvas.width = maskImage.width;
        tempMaskCanvas.height = maskImage.height;
        const tempMaskCtx = tempMaskCanvas.getContext('2d', { willReadFrequently: true });
        if (!tempMaskCtx) return;

        // Draw the grayscale mask from the model
        tempMaskCtx.drawImage(maskImage, 0, 0);
        const maskImageData = tempMaskCtx.getImageData(0, 0, maskImage.width, maskImage.height);
        const pixelData = maskImageData.data;

        // Colorize the mask: turn pixels > threshold into semi-transparent red
        for (let i = 0; i < pixelData.length; i += 4) {
          const intensity = pixelData[i]; // Grayscale, so R=G=B
          if (intensity > 127) { // Confidence threshold
            pixelData[i] = 255;     // R
            pixelData[i + 1] = 0;   // G
            pixelData[i + 2] = 0;   // B
            pixelData[i + 3] = 128; // A (50% transparent)
          } else {
            pixelData[i + 3] = 0; // Make other pixels fully transparent
          }
        }
        tempMaskCtx.putImageData(maskImageData, 0, 0);

        // 5. Draw the colorized and resized mask onto the main canvas at the correct position
        ctx.drawImage(tempMaskCanvas, absX, absY, boxWidth, boxHeight);

        // 6. Set the data URL for the final image
        setMaskUrl(canvas.toDataURL());
      };
      maskImage.onerror = (err) => {
          console.error("Failed to load mask image from data URL.", err);
      };
      
      // The model sometimes returns a python bytes literal string.
      // We'll try to clean it and then assume it's a base64 encoded PNG.
      const cleanedData = cleanupPythonBytesString(maskData);
      maskImage.src = `data:image/png;base64,${cleanedData}`;

    } catch (error) {
      console.error("Error processing segmentation mask:", error);
    }

  }, [maskData, box2d, width, height]);

  if (!maskUrl) return null;

  return (
    <img
      src={maskUrl}
      alt="Segmentation Mask"
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
    />
  );
};