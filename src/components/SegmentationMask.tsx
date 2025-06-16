import { useState, useEffect } from 'react';

interface MaskItemData {
  box_2d: [number, number, number, number];
  label: string;
  mask_url?: string;
  mask?: string;
}

interface SegmentationMaskProps {
  masks: MaskItemData[];
}

const MaskItem = ({ maskItem }: { maskItem: MaskItemData }) => {
  const { box_2d, label, mask_url, mask } = maskItem;
  const [processedMaskUrl, setProcessedMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    const imageUrl = mask_url || mask;
    if (!imageUrl) return;

    const img = new Image();
    img.crossOrigin = "anonymous"; // Important for canvas with external images
    img.onload = () => {
      const canvas = document.createElement('canvas');
      // The mask is small, we resize it to the bounding box dimensions
      const [yMin, xMin, yMax, xMax] = box_2d;
      const boxWidth = (xMax - xMin);
      const boxHeight = (yMax - yMin);

      // Use a reasonable max dimension to avoid creating huge canvases
      const MAX_DIM = 1024;
      const scale = Math.min(MAX_DIM / boxWidth, MAX_DIM / boxHeight, 1);
      
      canvas.width = boxWidth * scale;
      canvas.height = boxHeight * scale;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Draw the mask (resized to fit the canvas)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Apply threshold and color
      for (let i = 0; i < data.length; i += 4) {
        const probability = data[i]; // Use red channel as probability
        if (probability > 127) {
          // Set to red color
          data[i] = 255;     // R
          data[i + 1] = 0;   // G
          data[i + 2] = 0;   // B
          data[i + 3] = 150; // Alpha (60% opacity)
        } else {
          // Make transparent
          data[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      setProcessedMaskUrl(canvas.toDataURL());
    };
    img.onerror = () => {
      console.error(`Failed to load mask image.`);
    };
    img.src = imageUrl;

  }, [mask, mask_url, box_2d]);

  if (!processedMaskUrl) {
    return null;
  }

  const [yMin, xMin, yMax, xMax] = box_2d;
  const top = (yMin / 1000) * 100;
  const left = (xMin / 1000) * 100;
  const height = ((yMax - yMin) / 1000) * 100;
  const width = ((xMax - xMin) / 1000) * 100;

  return (
    <div
      className="absolute pointer-events-none"
      style={{ top: `${top}%`, left: `${left}%`, width: `${width}%`, height: `${height}%` }}
    >
      <img
        src={processedMaskUrl}
        alt={label}
        className="w-full h-full object-contain"
      />
    </div>
  );
};

export const SegmentationMask = ({ masks }: SegmentationMaskProps) => {
  if (!masks || masks.length === 0) {
    return null;
  }

  return (
    <>
      {masks.map((maskItem, index) => (
        <MaskItem key={index} maskItem={maskItem} />
      ))}
    </>
  );
};