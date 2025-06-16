import { useEffect, useState } from 'react';

export const SegmentationMask = ({ maskData, width, height }: { maskData: string, width: number, height: number }) => {
  const [maskUrl, setMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!maskData || !width || !height) {
        return;
    }

    try {
      // The maskData is a Base64 encoded PNG string. We can use it directly in a data URL.
      const dataUrl = `data:image/png;base64,${maskData}`;
      setMaskUrl(dataUrl);
    } catch (error) {
      console.error("[SegmentationMask] Failed to create data URL from mask:", error);
    }

  }, [maskData, width, height]);

  if (!maskUrl) return null;

  return (
    <img
      src={maskUrl}
      alt="Segmentation Mask"
      className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-50"
    />
  );
};