import { useEffect, useState } from 'react';

interface MaskItem {
  mask: string; // Base64 encoded PNG string
  box_2d: [number, number, number, number]; // [y_min, x_min, y_max, x_max] normalized to 1000
  label: string;
}

interface SegmentationMaskProps {
  masks: MaskItem[];
  width: number; // width of the container image
  height: number; // height of the container image
}

const cleanupPythonBytesString = (raw: string): string => {
    if (raw.startsWith("b'") && raw.endsWith("'")) {
        const inner = raw.slice(2, -1);
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

export const SegmentationMask = ({ masks, width, height }: SegmentationMaskProps) => {
  const [maskUrl, setMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!masks || masks.length === 0 || !width || !height) {
        setMaskUrl(null);
        return;
    };

    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = width;
    finalCanvas.height = height;
    const finalCtx = finalCanvas.getContext('2d');
    if (!finalCtx) return;

    const promises = masks.map(maskItem => {
        return new Promise<void>((resolve, reject) => {
            const { box_2d, mask: maskData } = maskItem;
            const [yMin, xMin, yMax, xMax] = box_2d;

            const absX = (xMin / 1000) * width;
            const absY = (yMin / 1000) * height;
            const boxWidth = ((xMax - xMin) / 1000) * width;
            const boxHeight = ((yMax - yMin) / 1000) * height;

            if (boxWidth <= 0 || boxHeight <= 0) return resolve();

            const maskImage = new Image();
            maskImage.onload = () => {
                const tempMaskCanvas = document.createElement('canvas');
                tempMaskCanvas.width = boxWidth;
                tempMaskCanvas.height = boxHeight;
                const tempMaskCtx = tempMaskCanvas.getContext('2d', { willReadFrequently: true });
                if (!tempMaskCtx) return reject(new Error("Could not create temp canvas context"));

                tempMaskCtx.drawImage(maskImage, 0, 0, boxWidth, boxHeight);
                const maskImageData = tempMaskCtx.getImageData(0, 0, boxWidth, boxHeight);
                const pixelData = maskImageData.data;

                for (let i = 0; i < pixelData.length; i += 4) {
                    if (pixelData[i] > 127) {
                        pixelData[i] = 255;     // R
                        pixelData[i + 1] = 0;   // G
                        pixelData[i + 2] = 0;   // B
                        pixelData[i + 3] = 128; // A (50% transparent)
                    } else {
                        pixelData[i + 3] = 0;
                    }
                }
                tempMaskCtx.putImageData(maskImageData, 0, 0);

                finalCtx.drawImage(tempMaskCanvas, absX, absY);
                resolve();
            };
            maskImage.onerror = (err) => reject(new Error(`Failed to load mask image: ${err}`));
            
            const cleanedData = cleanupPythonBytesString(maskData);
            maskImage.src = `data:image/png;base64,${cleanedData}`;
        });
    });

    Promise.all(promises).then(() => {
        setMaskUrl(finalCanvas.toDataURL());
    }).catch(error => {
        console.error("Error processing segmentation masks:", error);
    });

  }, [masks, width, height]);

  if (!maskUrl) return null;

  return (
    <img
      src={maskUrl}
      alt="Segmentation Mask"
      className="absolute top-0 left-0 w-full h-full pointer-events-none"
    />
  );
};