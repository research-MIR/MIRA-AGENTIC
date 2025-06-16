import { useState, useEffect } from 'react';

interface MaskItemData {
  box_2d: [number, number, number, number];
  label: string;
  mask_url?: string;
  mask?: string;
}

interface SegmentationMaskProps {
  masks: MaskItemData[];
  imageDimensions: { width: number; height: number };
}

const MaskItem = ({ maskItem, imageDimensions }: { maskItem: MaskItemData, imageDimensions: { width: number; height: number } }) => {
  const [processedMaskUrl, setProcessedMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    const imageUrl = mask_url || (maskItem.mask ? `data:image/png;base64,${maskItem.mask}` : null);
    if (!imageUrl) return;

    const maskImg = new Image();
    maskImg.crossOrigin = "anonymous";
    maskImg.onload = () => {
      // 1. Calculate absolute pixel values for the bounding box
      const [y0, x0, y1, x1] = maskItem.box_2d;
      const absX0 = Math.floor((x0 / 1000) * imageDimensions.width);
      const absY0 = Math.floor((y0 / 1000) * imageDimensions.height);
      const bboxWidth = Math.ceil(((x1 - x0) / 1000) * imageDimensions.width);
      const bboxHeight = Math.ceil(((y1 - y0) / 1000) * imageDimensions.height);

      if (bboxWidth < 1 || bboxHeight < 1) return;

      // 2. Create a canvas for the resized mask
      const resizedMaskCanvas = document.createElement('canvas');
      resizedMaskCanvas.width = bboxWidth;
      resizedMaskCanvas.height = bboxHeight;
      const resizedCtx = resizedMaskCanvas.getContext('2d');
      if (!resizedCtx) return;
      resizedCtx.drawImage(maskImg, 0, 0, bboxWidth, bboxHeight);

      // 3. Create the full-size canvas
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = imageDimensions.width;
      fullCanvas.height = imageDimensions.height;
      const fullCtx = fullCanvas.getContext('2d');
      if (!fullCtx) return;

      // 4. Composite the resized mask onto the full-size canvas at the correct position
      fullCtx.drawImage(resizedMaskCanvas, absX0, absY0);

      // 5. Get the full image data to apply threshold and color
      const imageData = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        // The mask is grayscale, so R, G, and B channels are the same.
        // We use the red channel as the probability value.
        const probability = data[i];
        if (probability > 127) {
          data[i] = 255;     // R
          data[i + 1] = 0;   // G
          data[i + 2] = 0;   // B
          data[i + 3] = 150; // Alpha (60% opacity)
        } else {
          // Make transparent
          data[i + 3] = 0;
        }
      }
      fullCtx.putImageData(imageData, 0, 0);

      // 6. Set the final data URL for rendering
      setProcessedMaskUrl(fullCanvas.toDataURL());
    };
    maskImg.onerror = () => console.error(`Failed to load mask image.`);
    maskImg.src = imageUrl;

  }, [maskItem, imageDimensions]);

  if (!processedMaskUrl) {
    return null;
  }

  // This component now renders a single, full-size overlay
  return (
    <img
      src={processedMaskUrl}
      alt={maskItem.label}
      className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
    />
  );
};

export const SegmentationMask = ({ masks, imageDimensions }: SegmentationMaskProps) => {
  if (!masks || masks.length === 0 || !imageDimensions) {
    return null;
  }

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
      {masks.map((maskItem, index) => (
        <MaskItem key={index} maskItem={maskItem} imageDimensions={imageDimensions} />
      ))}
    </div>
  );
};