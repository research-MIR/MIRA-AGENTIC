interface MaskItem {
  box_2d: [number, number, number, number]; // [y_min, x_min, y_max, x_max] normalized to 1000
  label: string;
  mask_url?: string;
  mask?: string; // Now accepting base64 data URI
}

interface SegmentationMaskProps {
  masks: MaskItem[];
}

export const SegmentationMask = ({ masks }: SegmentationMaskProps) => {
  console.log('[SegmentationMask] Component rendered with masks prop:', masks);

  if (!masks || masks.length === 0) {
    console.log('[SegmentationMask] No masks provided or empty array. Rendering null.');
    return null;
  }

  return (
    <>
      {masks.map((maskItem, index) => {
        console.log(`[SegmentationMask] Processing mask item #${index}:`, maskItem);

        const { box_2d, label, mask_url, mask } = maskItem;
        const imageUrl = mask_url || mask;

        if (!imageUrl) {
          console.log(`[SegmentationMask] No imageUrl for mask #${index}. Skipping.`);
          return null;
        }

        const [yMin, xMin, yMax, xMax] = box_2d;

        const top = (yMin / 1000) * 100;
        const left = (xMin / 1000) * 100;
        const boxHeight = ((yMax - yMin) / 1000) * 100;
        const boxWidth = ((xMax - xMin) / 1000) * 100;

        console.log(`[SegmentationMask] Calculated styles for mask #${index}:`, { top, left, boxWidth, boxHeight });

        if (boxWidth <= 0 || boxHeight <= 0) {
          console.log(`[SegmentationMask] Invalid dimensions for mask #${index}. Skipping.`);
          return null;
        }

        return (
          <div
            key={index}
            className="absolute pointer-events-none"
            style={{
              top: `${top}%`,
              left: `${left}%`,
              width: `${boxWidth}%`,
              height: `${boxHeight}%`,
              border: '2px solid red', // DEBUG: Add a border to see the container
              zIndex: 10,
            }}
          >
            <img
              src={imageUrl}
              alt={label}
              className="w-full h-full"
              style={{
                filter: 'brightness(0) invert(48%) sepia(89%) saturate(3000%) hue-rotate(335deg)',
                opacity: 0.6
              }}
              onLoad={() => console.log(`[SegmentationMask] Image for mask #${index} loaded successfully.`)}
              onError={() => console.error(`[SegmentationMask] Image for mask #${index} failed to load. URL starts with: ${imageUrl.substring(0, 100)}...`)}
            />
            <div className="absolute -top-6 left-0 bg-red-500 text-white text-xs font-bold px-1 py-0.5 rounded-sm">
              {label}
            </div>
          </div>
        );
      })}
    </>
  );
};