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
      const [y0, x0, y1, x1] = maskItem.box_2d;
      const absX0 = Math.floor((x0 / 1000) * imageDimensions.width);
      const absY0 = Math.floor((y0 / 1000) * imageDimensions.height);
      const bboxWidth = Math.ceil(((x1 - x0) / 1000) * imageDimensions.width);
      const bboxHeight = Math.ceil(((y1 - y0) / 1000) * imageDimensions.height);

      if (bboxWidth < 1 || bboxHeight < 1) {
        console.error('[MaskItem] ERROR: Bounding box has zero or negative dimensions. Aborting.');
        return;
      }

      const resizedMaskCanvas = document.createElement('canvas');
      resizedMaskCanvas.width = bboxWidth;
      resizedMaskCanvas.height = bboxHeight;
      const resizedCtx = resizedMaskCanvas.getContext('2d');
      if (!resizedCtx) return;
      resizedCtx.drawImage(maskImg, 0, 0, bboxWidth, bboxHeight);

      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = imageDimensions.width;
      fullCanvas.height = imageDimensions.height;
      const fullCtx = fullCanvas.getContext('2d');
      if (!fullCtx) return;
      
      fullCtx.drawImage(resizedMaskCanvas, absX0, absY0);

      const imageData = fullCtx.getImageData(0, 0, fullCanvas.width, fullCanvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const probability = data[i];
        if (probability > 127) {
          data[i] = 255;
          data[i + 1] = 0;
          data[i + 2] = 0;
          data[i + 3] = 150;
        } else {
          data[i + 3] = 0;
        }
      }
      fullCtx.putImageData(imageData, 0, 0);

      setProcessedMaskUrl(fullCanvas.toDataURL());
    };
    maskImg.onerror = (err) => {
      console.error('[MaskItem] ERROR: maskImg.onerror - Failed to load mask image.', err);
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

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
      {masks.map((maskItem, index) => (
        <MaskItem key={index} maskItem={maskItem} imageDimensions={imageDimensions} />
      ))}
    </div>
  );
};