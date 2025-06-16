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
    console.log('[MaskItem] LOG: useEffect triggered.', { maskItem, imageDimensions });
    // The AI response contains the full data URI in the `mask` property.
    const imageUrl = maskItem.mask;
    if (!imageUrl) {
      console.error('[MaskItem] ERROR: No mask data found in maskItem.mask.');
      return;
    }
    console.log(`[MaskItem] LOG: Attempting to load mask from data URL (first 100 chars): ${imageUrl.substring(0, 100)}...`);

    const maskImg = new Image();
    maskImg.crossOrigin = "anonymous";
    maskImg.onload = () => {
      console.log(`[MaskItem] LOG: maskImg.onload - Successfully loaded mask image with original dimensions ${maskImg.width}x${maskImg.height}`);
      
      const [y0, x0, y1, x1] = maskItem.box_2d;
      const absX0 = Math.floor((x0 / 1000) * imageDimensions.width);
      const absY0 = Math.floor((y0 / 1000) * imageDimensions.height);
      const bboxWidth = Math.ceil(((x1 - x0) / 1000) * imageDimensions.width);
      const bboxHeight = Math.ceil(((y1 - y0) / 1000) * imageDimensions.height);
      console.log(`[MaskItem] LOG: Calculated BBox (pixels): { x: ${absX0}, y: ${absY0}, w: ${bboxWidth}, h: ${bboxHeight} }`);

      if (bboxWidth < 1 || bboxHeight < 1) {
        console.error('[MaskItem] ERROR: Bounding box has zero or negative dimensions. Aborting.');
        return;
      }

      const resizedMaskCanvas = document.createElement('canvas');
      resizedMaskCanvas.width = bboxWidth;
      resizedMaskCanvas.height = bboxHeight;
      const resizedCtx = resizedMaskCanvas.getContext('2d');
      if (!resizedCtx) {
        console.error('[MaskItem] ERROR: Failed to get context for resizedMaskCanvas.');
        return;
      }
      resizedCtx.drawImage(maskImg, 0, 0, bboxWidth, bboxHeight);
      console.log(`[MaskItem] LOG: Drew mask onto resized canvas of ${bboxWidth}x${bboxHeight}`);

      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = imageDimensions.width;
      fullCanvas.height = imageDimensions.height;
      const fullCtx = fullCanvas.getContext('2d');
      if (!fullCtx) {
        console.error('[MaskItem] ERROR: Failed to get context for fullCanvas.');
        return;
      }
      console.log(`[MaskItem] LOG: Created full-size canvas of ${fullCanvas.width}x${fullCanvas.height}`);

      fullCtx.drawImage(resizedMaskCanvas, absX0, absY0);
      console.log(`[MaskItem] LOG: Composited resized mask onto full canvas at (${absX0}, ${absY0})`);

      const imageData = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
      const data = imageData.data;
      console.log(`[MaskItem] LOG: Got ImageData of size ${data.length}. Starting pixel manipulation.`);
      let coloredPixelCount = 0;

      for (let i = 0; i < data.length; i += 4) {
        const probability = data[i];
        if (probability > 127) {
          data[i] = 255;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 150;
          coloredPixelCount++;
        } else {
          data[i + 3] = 0;
        }
      }
      console.log(`[MaskItem] LOG: Pixel manipulation complete. Colored ${coloredPixelCount} pixels.`);
      fullCtx.putImageData(imageData, 0, 0);

      const finalUrl = fullCanvas.toDataURL();
      console.log(`[MaskItem] LOG: Generated final data URL with length ${finalUrl.length}. Setting state.`);
      if (finalUrl.length < 100) {
          console.error('[MaskItem] ERROR: Generated data URL is suspiciously short. It might be a blank canvas.');
      }
      setProcessedMaskUrl(finalUrl);
    };
    maskImg.onerror = (err) => {
      console.error('[MaskItem] ERROR: maskImg.onerror - Failed to load mask image.', err);
    };
    maskImg.src = imageUrl;

  }, [maskItem, imageDimensions]);

  if (!processedMaskUrl) {
    console.log(`[MaskItem] LOG: Render check - processedMaskUrl is null, rendering nothing.`);
    return null;
  }

  console.log(`[MaskItem] LOG: Render check - processedMaskUrl is set, rendering image overlay.`);
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