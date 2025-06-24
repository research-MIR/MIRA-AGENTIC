import { useState, useEffect } from 'react';

interface MaskItemData {
  box_2d: [number, number, number, number];
  label: string;
  mask?: string;
}

interface SegmentationMaskProps {
  masks: MaskItemData[];
  imageDimensions: { width: number; height: number };
}

const MaskItem = ({ maskItem, imageDimensions }: { maskItem: MaskItemData, imageDimensions: { width: number; height: number } }) => {
  const [processedMaskUrl, setProcessedMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    console.log(`[MaskItem] Processing mask for label: "${maskItem.label}"`);
    const base64Data = maskItem.mask;
    if (!base64Data) {
      console.error('[MaskItem] ERROR: No mask data found in maskItem.mask.');
      return;
    }
    
    const imageUrl = base64Data.startsWith('data:image')
      ? base64Data
      : `data:image/png;base64,${base64Data}`;

    const maskImg = new Image();
    maskImg.crossOrigin = "anonymous";
    maskImg.onload = () => {
      console.log(`[MaskItem] Decoded base64 mask for "${maskItem.label}" successfully.`);
      const [y0, x0, y1, x1] = maskItem.box_2d;
      const absX0 = Math.floor((x0 / 1000) * imageDimensions.width);
      const absY0 = Math.floor((y0 / 1000) * imageDimensions.height);
      const bboxWidth = Math.ceil(((x1 - x0) / 1000) * imageDimensions.width);
      const bboxHeight = Math.ceil(((y1 - y0) / 1000) * imageDimensions.height);

      console.log(`[MaskItem] Calculated absolute bbox for "${maskItem.label}":`, { x: absX0, y: absY0, width: bboxWidth, height: bboxHeight });

      if (bboxWidth < 1 || bboxHeight < 1) {
        console.error('[MaskItem] ERROR: Bounding box has zero or negative dimensions. Aborting.');
        return;
      }

      const resizedMaskCanvas = document.createElement('canvas');
      resizedMaskCanvas.width = bboxWidth;
      resizedMaskCanvas.height = bboxHeight;
      const resizedCtx = resizedMaskCanvas.getContext('2d');
      if (!resizedCtx) return;
      
      // Draw the initial mask
      resizedCtx.drawImage(maskImg, 0, 0, bboxWidth, bboxHeight);
      
      // --- NEW: Expand and Smooth the mask ---
      // 1. Calculate expansion amount (5% of the smaller dimension of the bounding box)
      const expansionAmount = Math.round(Math.min(bboxWidth, bboxHeight) * 0.05);
      console.log(`[MaskItem] Applying ${expansionAmount}px expansion/smoothing to mask for "${maskItem.label}".`);

      // 2. Apply a blur filter to expand the mask
      resizedCtx.filter = `blur(${expansionAmount}px)`;
      // We need to draw the image again for the filter to apply. We draw the canvas onto itself.
      resizedCtx.drawImage(resizedMaskCanvas, 0, 0);
      
      // 3. Reset the filter
      resizedCtx.filter = 'none';

      // 4. Threshold the blurred mask to make it sharp again (dilation effect)
      const imageData = resizedCtx.getImageData(0, 0, bboxWidth, bboxHeight);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        // If the pixel is more than 50% white after blurring, make it fully white. Otherwise, black.
        if (data[i] > 128) {
          data[i] = 255;
          data[i+1] = 255;
          data[i+2] = 255;
        } else {
          data[i] = 0;
          data[i+1] = 0;
          data[i+2] = 0;
        }
      }
      resizedCtx.putImageData(imageData, 0, 0);
      // --- END of new logic ---

      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = imageDimensions.width;
      fullCanvas.height = imageDimensions.height;
      const fullCtx = fullCanvas.getContext('2d');
      if (!fullCtx) return;
      
      fullCtx.drawImage(resizedMaskCanvas, absX0, absY0);
      console.log(`[MaskItem] Positioned processed mask for "${maskItem.label}" on full-size canvas.`);

      const finalImageData = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
      const finalData = finalImageData.data;

      for (let i = 0; i < finalData.length; i += 4) {
        const probability = finalData[i];
        if (probability > 127) {
          finalData[i] = 255;
          finalData[i + 1] = 0;
          finalData[i + 2] = 0;
          finalData[i + 3] = 150;
        } else {
          finalData[i + 3] = 0;
        }
      }
      fullCtx.putImageData(finalImageData, 0, 0);
      console.log(`[MaskItem] Colorized and applied alpha to mask for "${maskItem.label}".`);

      setProcessedMaskUrl(fullCanvas.toDataURL());
    };
    maskImg.onerror = (err) => {
      console.error(`[MaskItem] ERROR: maskImg.onerror - Failed to load mask image for label "${maskItem.label}".`, err);
    };
    maskImg.src = imageUrl;

  }, [maskItem, imageDimensions]);

  if (!processedMaskUrl) {
    return null;
  }

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

  console.log(`[SegmentationMask] Rendering ${masks.length} masks.`);

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
      {masks.map((maskItem, index) => (
        <MaskItem key={index} maskItem={maskItem} imageDimensions={imageDimensions} />
      ))}
    </div>
  );
};