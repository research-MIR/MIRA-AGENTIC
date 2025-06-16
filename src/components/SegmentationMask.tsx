import { useEffect, useState } from 'react';

interface SegmentationMaskProps {
  maskData: string; // The base64 encoded RLE mask
  width: number;
  height: number;
}

// Decodes a simple Run-Length Encoded byte array.
// Assumes format is [value, count, value, count, ...]
const decodeRLE = (rle: Uint8Array, width: number, height: number): Uint8ClampedArray => {
  const output = new Uint8ClampedArray(width * height);
  let outputIndex = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const value = rle[i];
    const count = rle[i + 1];
    for (let j = 0; j < count; j++) {
      if (outputIndex < output.length) {
        output[outputIndex++] = value;
      } else {
        // Stop if we've filled the expected output array to prevent overflow
        // from potentially malformed RLE data.
        console.warn("RLE data exceeds image dimensions.");
        return output;
      }
    }
  }
  return output;
};


export const SegmentationMask = ({ maskData, width, height }: SegmentationMaskProps) => {
  const [maskUrl, setMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!maskData || !width || !height) return;

    try {
      let decodedData;
      // The AI model doesn't always follow the Base64 encoding instruction.
      // We'll try to decode it, but if it fails, we'll assume the data is raw.
      try {
        decodedData = atob(maskData);
      } catch (e) {
        console.warn("atob() failed, assuming mask data is not Base64 encoded.", e);
        decodedData = maskData; // Use the raw string
      }

      const charData = decodedData.split('').map(x => x.charCodeAt(0));
      const byteArray = new Uint8Array(charData);

      // RLE decode the byte array
      const pixelData = decodeRLE(byteArray, width, height);
      
      // Create ImageData and draw to a temporary canvas
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

      // Create a data URL from the canvas to use in an <img> tag
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