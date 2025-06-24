import { useState, useEffect } from 'react';

interface MaskItemData {
  box_2d: [number, number, number, number];
  label: string;
  mask?: string;
}

interface SegmentationMaskProps {
  masks: MaskItemData[][];
  imageDimensions: { width: number; height: number };
}

const processMasks = async (
  maskRuns: MaskItemData[], 
  imageDimensions: { width: number; height: number }
): Promise<string | null> => {
  if (maskRuns.length === 0) return null;

  // 1. Load all mask images from base64
  const maskImages = await Promise.all(maskRuns.map(run => {
    const imageUrl = run.mask?.startsWith('data:image') ? run.mask : `data:image/png;base64,${run.mask}`;
    const img = new Image();
    img.crossOrigin = "anonymous";
    return new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = imageUrl;
    });
  }));

  // 2. Create full-size canvases for each mask
  const fullMaskCanvases = maskRuns.map((run, index) => {
    const maskImg = maskImages[index];
    const [y0, x0, y1, x1] = run.box_2d;
    const absX0 = Math.floor((x0 / 1000) * imageDimensions.width);
    const absY0 = Math.floor((y0 / 1000) * imageDimensions.height);
    const bboxWidth = Math.ceil(((x1 - x0) / 1000) * imageDimensions.width);
    const bboxHeight = Math.ceil(((y1 - y0) / 1000) * imageDimensions.height);

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = imageDimensions.width;
    fullCanvas.height = imageDimensions.height;
    const ctx = fullCanvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(maskImg, absX0, absY0, bboxWidth, bboxHeight);
    return fullCanvas;
  }).filter((c): c is HTMLCanvasElement => c !== null);

  if (fullMaskCanvases.length === 0) return null;

  // 3. Combine the masks
  const combinedCanvas = document.createElement('canvas');
  combinedCanvas.width = imageDimensions.width;
  combinedCanvas.height = imageDimensions.height;
  const combinedCtx = combinedCanvas.getContext('2d');
  if (!combinedCtx) return null;

  const maskContexts = fullMaskCanvases.map(c => c.getContext('2d'));
  const maskImageDatas = maskContexts.map(ctx => ctx?.getImageData(0, 0, imageDimensions.width, imageDimensions.height).data);
  
  const combinedImageData = combinedCtx.createImageData(imageDimensions.width, imageDimensions.height);
  const combinedData = combinedImageData.data;

  // If there's only one run, we don't need to vote. Just copy it over.
  if (maskImageDatas.length === 1 && maskImageDatas[0]) {
      const singleMaskData = maskImageDatas[0];
      for (let i = 0; i < combinedData.length; i += 4) {
          if (singleMaskData[i] > 128) { // Check red channel
              combinedData[i] = 255;
              combinedData[i+1] = 255;
              combinedData[i+2] = 255;
              combinedData[i+3] = 255;
          }
      }
  } else { // Existing voting logic for multiple runs
      for (let i = 0; i < combinedData.length; i += 4) {
          let voteCount = 0;
          for (const data of maskImageDatas) {
              if (data && data[i] > 128) { // Check red channel
                  voteCount++;
              }
          }
          // Keep the pixel if it's present in at least 2 of the 3 runs
          if (voteCount >= 2) {
              combinedData[i] = 255;
              combinedData[i+1] = 255;
              combinedData[i+2] = 255;
              combinedData[i+3] = 255;
          }
      }
  }
  combinedCtx.putImageData(combinedImageData, 0, 0);

  // 4. Smooth the combined mask
  const expansionAmount = Math.round(Math.min(imageDimensions.width, imageDimensions.height) * 0.01); // Smaller expansion now, maybe 1%
  if (expansionAmount > 0) {
    combinedCtx.filter = `blur(${expansionAmount}px)`;
    combinedCtx.drawImage(combinedCanvas, 0, 0);
    combinedCtx.filter = 'none';
    
    // Threshold again
    const smoothedImageData = combinedCtx.getImageData(0, 0, imageDimensions.width, imageDimensions.height);
    const smoothedData = smoothedImageData.data;
    for (let i = 0; i < smoothedData.length; i += 4) {
      if (smoothedData[i] > 128) {
        smoothedData[i] = 255;
        smoothedData[i+1] = 255;
        smoothedData[i+2] = 255;
      }
    }
    combinedCtx.putImageData(smoothedImageData, 0, 0);
  }

  // 5. Colorize and apply alpha
  const finalImageData = combinedCtx.getImageData(0, 0, imageDimensions.width, imageDimensions.height);
  const finalData = finalImageData.data;
  for (let i = 0; i < finalData.length; i += 4) {
    if (finalData[i] > 128) {
      finalData[i] = 255;
      finalData[i + 1] = 0;
      finalData[i + 2] = 0;
      finalData[i + 3] = 150;
    } else {
      finalData[i + 3] = 0;
    }
  }
  combinedCtx.putImageData(finalImageData, 0, 0);

  return combinedCanvas.toDataURL();
};

const CombinedMask = ({ maskRuns, imageDimensions }: { maskRuns: MaskItemData[], imageDimensions: { width: number; height: number } }) => {
  const [processedMaskUrl, setProcessedMaskUrl] = useState<string | null>(null);

  useEffect(() => {
    processMasks(maskRuns, imageDimensions).then(url => {
      setProcessedMaskUrl(url);
    });
  }, [maskRuns, imageDimensions]);

  if (!processedMaskUrl) return null;

  return (
    <img
      src={processedMaskUrl}
      alt="Combined Mask"
      className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none"
    />
  );
};

export const SegmentationMask = ({ masks, imageDimensions }: SegmentationMaskProps) => {
  if (!masks || masks.length === 0 || !imageDimensions) {
    return null;
  }

  // For now, let's just combine the first mask from each run.
  // A more complex implementation would handle multiple objects.
  const firstMasksFromEachRun = masks.map(run => run[0]).filter(Boolean);

  if (firstMasksFromEachRun.length === 0) return null;

  return (
    <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
      <CombinedMask maskRuns={firstMasksFromEachRun} imageDimensions={imageDimensions} />
    </div>
  );
};