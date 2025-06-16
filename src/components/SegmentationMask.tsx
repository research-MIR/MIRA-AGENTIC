import { useEffect, useState } from 'react';

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


export const SegmentationMask = ({ maskData, width, height }: { maskData: string, width: number, height: number }) => {
  const [maskUrl, setMaskUrl] = useState<string | null>(null);
  console.log('[SegmentationMask] Rendering with props:', { maskData, width, height });

  useEffect(() => {
    console.log('[SegmentationMask] useEffect triggered. Processing maskData.');
    if (!maskData || !width || !height) {
        console.log('[SegmentationMask] Missing props, exiting useEffect.');
        return;
    }

    try {
      const decodedString = atob(maskData);
      console.log('[SegmentationMask] Decoded Base64 string:', decodedString);
      let rleData: number[];

      try {
        // The AI is returning a Base64 encoded JSON array string.
        // We first decode the Base64, then parse the resulting string as JSON.
        rleData = JSON.parse(decodedString);
        console.log('[SegmentationMask] Parsed RLE data from JSON:', rleData);
        if (!Array.isArray(rleData)) {
          throw new Error("Parsed mask data is not an array.");
        }
      } catch (e) {
        // If JSON parsing fails, we fall back to the original method of treating it as a raw byte string.
        // This makes the component more robust to future changes in the AI's output.
        console.warn("Could not parse mask as JSON, falling back to raw byte string.", e);
        rleData = decodedString.split('').map(x => x.charCodeAt(0));
      }
      
      const byteArray = new Uint8Array(rleData);
      const pixelData = decodeRLE(byteArray, width, height);
      
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

      const objectUrl = canvas.toDataURL();
      setMaskUrl(objectUrl);
      console.log('[SegmentationMask] Created mask URL.');

    } catch (error) {
      console.error("[SegmentationMask] Failed to decode and render mask:", error);
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