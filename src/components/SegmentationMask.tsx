import { useEffect, useState } from 'react';
import pako from 'https://esm.sh/pako@2.1.0';

interface SegmentationMaskProps {
  maskData: string; // The base64 encoded, zlib compressed mask
  width: number;
  height: number;
}

export const SegmentationMask = ({ maskData, width, height }: SegmentationMaskProps) => {
  const [maskUrl, setMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!maskData || !width || !height) return;

    try {
      // 1. Base64 decode
      const decodedData = atob(maskData);
      const charData = decodedData.split('').map(x => x.charCodeAt(0));
      const byteArray = new Uint8Array(charData);

      // 2. Zlib inflate to get the raw pixel data
      const pixelData = pako.inflate(byteArray);
      
      if (pixelData.length !== width * height) {
          console.error(`Mask data size (${pixelData.length}) does not match image dimensions (${width}x${height} = ${width*height}). This may result in a distorted mask.`);
      }

      // 3. Create ImageData and draw to a temporary canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const imageData = ctx.createImageData(width, height);
      for (let i = 0; i < pixelData.length; i++) {
        if (pixelData[i] > 0) { // If it's part of the mask
          imageData.data[i * 4] = 255;     // R
          imageData.data[i * 4 + 1] = 0;   // G
          imageData.data[i * 4 + 2] = 0;   // B
          imageData.data[i * 4 + 3] = 128; // A (50% transparent red)
        }
      }
      ctx.putImageData(imageData, 0, 0);

      // 4. Create a data URL from the canvas to use in an <img> tag
      const objectUrl = canvas.toDataURL();
      setMaskUrl(objectUrl);

    } catch (error) {
      console.error("Failed to decode and render mask:", error);
    }

  }, [maskData, width, height]);

  if (!maskUrl) return null;

  return (
    <img
      src={maskUrl}
      alt="Segmentation Mask"
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
    />
  );
};